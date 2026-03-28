/**
 * Context Manager — Per-Character Lorebook Writer
 *
 * Automatically discovers character lorebooks, makes separate LLM calls
 * per character with {{char}} resolved correctly, and writes per-character
 * entries to each character's lorebook.
 *
 * Lives in new files to avoid upstream merge conflicts.
 */

import { chat, chat_metadata, characters, name2, this_chid, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { selected_group, groups } from '../../../group-chats.js';
import { eventSource, event_types } from '../../../../script.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { requestCompletion } from './stmemory.js';
import { upsertLorebookEntryByTitle, getEntryByTitle } from './addlore.js';
import { createSceneRequest, compileScene, toReadableText } from './chatcompile.js';
import { fetchPreviousSummaries } from './confirmationPopup.js';
import { applySidePromptMacros, extractMacroTokens, parseSidePromptCommandInput } from './sidePromptMacros.js';
import { getRegexedString, regex_placement } from '../../../extensions/regex/engine.js';
import { oai_settings } from '../../../openai.js';
import {
    getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource,
    resolveEffectiveConnectionFromProfile, clampInt,
    createStmbInFlightTask, isStmbStopError, getStmbStopEpoch, throwIfStmbStopped,
} from './utils.js';
import { getSceneMarkers, saveMetadataForCurrentContext } from './sceneManager.js';
import { executeSlashCommands } from '../../../slash-commands.js';
import { t as __st_t_tag, translate } from '../../../i18n.js';

const MODULE_NAME = 'STMemoryBooks-ContextManager';
const CM_TITLE_SUFFIX = ' (STMB CM)';

// ─── Template CRUD (extension_settings storage) ────────────────────────

function getSettings() {
    const s = extension_settings?.STMemoryBooks;
    if (!s) return null;
    if (!s.contextManagerTemplates) s.contextManagerTemplates = {};
    return s;
}

function getTemplatesMap() {
    return getSettings()?.contextManagerTemplates ?? {};
}

function nowIso() {
    return new Date().toISOString();
}

function safeSlug(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50) || 'cm-template';
}

export function listTemplates() {
    const map = getTemplatesMap();
    const list = Object.values(map);
    list.sort((a, b) => {
        const at = a.updatedAt || a.createdAt || '';
        const bt = b.updatedAt || b.createdAt || '';
        return bt.localeCompare(at);
    });
    return list;
}

export function getTemplate(key) {
    return getTemplatesMap()[key] || null;
}

export function findTemplateByName(name) {
    const map = getTemplatesMap();
    const raw = String(name || '').trim();
    if (!raw) return null;
    const targetLower = raw.toLowerCase();
    const targetSlug = safeSlug(raw);

    const templates = Object.values(map);

    for (const p of templates) {
        const nameLower = String(p.name || '').toLowerCase();
        const keyLower = String(p.key || '').toLowerCase();
        if (nameLower === targetLower || keyLower === targetLower || safeSlug(p.name) === targetSlug) {
            return p;
        }
    }
    for (const p of templates) {
        const nameLower = String(p.name || '').toLowerCase();
        if (nameLower.startsWith(targetLower) || safeSlug(p.name).startsWith(targetSlug)) {
            return p;
        }
    }
    return null;
}

export function upsertTemplate(input) {
    const s = getSettings();
    if (!s) return null;
    const map = s.contextManagerTemplates;
    const isNew = !input.key;
    const ts = nowIso();

    const requestedName = String(input.name ?? '').trim();
    const cur = isNew ? null : map[input.key];
    const finalName = requestedName || (isNew ? 'Untitled Context Manager' : (cur?.name || 'Untitled Context Manager'));

    let key;
    if (input.key) {
        key = input.key;
    } else {
        key = safeSlug(finalName);
        let suffix = 0;
        while (map[key]) {
            suffix++;
            key = `${safeSlug(finalName)}-${suffix}`;
        }
    }

    const existing = map[key];
    const merged = {
        ...(existing || {}),
        key,
        name: finalName,
        enabled: input.enabled ?? existing?.enabled ?? true,
        prompt: input.prompt ?? existing?.prompt ?? '',
        responseFormat: input.responseFormat ?? existing?.responseFormat ?? '',
        settings: { ...(existing?.settings || {}), ...(input.settings || {}) },
        triggers: { ...(existing?.triggers || {}), ...(input.triggers || {}) },
        createdAt: existing?.createdAt || ts,
        updatedAt: ts,
    };

    // Deep-merge lorebook sub-object
    if (input.settings?.lorebook) {
        merged.settings.lorebook = { ...(existing?.settings?.lorebook || {}), ...(input.settings.lorebook) };
    }

    map[key] = merged;
    saveSettingsDebounced();
    return merged;
}

export function removeTemplate(key) {
    const s = getSettings();
    if (!s) return false;
    if (!s.contextManagerTemplates[key]) return false;
    delete s.contextManagerTemplates[key];
    saveSettingsDebounced();
    return true;
}

export function duplicateTemplate(key) {
    const src = getTemplate(key);
    if (!src) return null;
    const ts = nowIso();
    const newName = `${src.name} (copy)`;
    return upsertTemplate({
        name: newName,
        enabled: false,
        prompt: src.prompt,
        responseFormat: src.responseFormat,
        settings: JSON.parse(JSON.stringify(src.settings || {})),
        triggers: JSON.parse(JSON.stringify(src.triggers || {})),
    });
}

function listByTrigger(triggerKind) {
    return listTemplates().filter(tpl => {
        if (!tpl.enabled) return false;
        if (triggerKind === 'onInterval') {
            return tpl.triggers?.onInterval && Number(tpl.triggers.onInterval.visibleMessages) >= 1;
        }
        if (triggerKind === 'onAfterMemory') {
            return !!tpl.triggers?.onAfterMemory?.enabled;
        }
        return false;
    });
}

function getChatDisabledKeys() {
    return getSceneMarkers()?.disabledContextManager ?? [];
}

// ─── Character Lorebook Discovery ──────────────────────────────────────

export function discoverCharacterLorebooks() {
    if (selected_group) {
        const group = groups?.find(x => x.id === selected_group);
        if (!group?.members) return [];
        return group.members
            .map(avatar => characters.find(c => c.avatar === avatar))
            .filter(Boolean)
            .map(char => ({
                characterName: char.name,
                lorebookName: char?.data?.extensions?.world || null,
                avatar: char.avatar,
            }));
    } else {
        const char = (this_chid !== undefined && characters?.[this_chid]) || null;
        if (!char) return [];
        return [{
            characterName: char.name || name2,
            lorebookName: char?.data?.extensions?.world || null,
            avatar: char.avatar,
        }];
    }
}

// ─── Missing Lorebook Popup ────────────────────────────────────────────

async function handleMissingLorebook(characterName) {
    const availableBooks = Array.isArray(world_names) ? world_names.filter(n => n && n.trim()) : [];
    const optionsHtml = availableBooks.map(n =>
        `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`
    ).join('');

    const html = DOMPurify.sanitize(`
        <div style="padding: 8px;">
            <p><strong>${escapeHtml(characterName)}</strong> has no lorebook attached.</p>
            <p>Choose an option:</p>
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                <button id="stmb-cm-create-lb" class="menu_button" style="width: 100%;">
                    Create new lorebook "${escapeHtml(characterName)}"
                </button>
                ${availableBooks.length > 0 ? `
                <div style="display: flex; gap: 6px; align-items: center;">
                    <select id="stmb-cm-select-lb" style="flex: 1; padding: 4px;">
                        ${optionsHtml}
                    </select>
                    <button id="stmb-cm-attach-lb" class="menu_button">Attach</button>
                </div>` : ''}
                <button id="stmb-cm-skip-lb" class="menu_button" style="width: 100%; opacity: 0.7;">
                    Skip this character
                </button>
            </div>
        </div>
    `);

    return new Promise((resolve) => {
        const popup = new Popup(html, POPUP_TYPE.TEXT, null, {
            okButton: false,
            cancelButton: false,
            wide: false,
        });

        const show = popup.show();

        const dlg = document.querySelector('.popup:last-of-type');
        if (!dlg) {
            resolve({ action: 'skipped' });
            return;
        }

        dlg.querySelector('#stmb-cm-create-lb')?.addEventListener('click', async () => {
            await popup.complete(POPUP_RESULT.OK);
            resolve({ action: 'created', lorebookName: characterName });
        });

        dlg.querySelector('#stmb-cm-attach-lb')?.addEventListener('click', async () => {
            const sel = dlg.querySelector('#stmb-cm-select-lb');
            const name = sel?.value;
            if (name) {
                await popup.complete(POPUP_RESULT.OK);
                resolve({ action: 'selected', lorebookName: name });
            }
        });

        dlg.querySelector('#stmb-cm-skip-lb')?.addEventListener('click', async () => {
            await popup.complete(POPUP_RESULT.CANCELLED);
            resolve({ action: 'skipped' });
        });

        show.then(() => resolve({ action: 'skipped' }));
    });
}

// ─── Prompt Building ───────────────────────────────────────────────────

function buildCMPrompt(templatePrompt, priorContent, compiledScene, responseFormat, previousSummaries = [], runtimeMacros = {}) {
    const parts = [];
    parts.push(applySidePromptMacros(templatePrompt, runtimeMacros));

    if (priorContent && String(priorContent).trim()) {
        parts.push('\n=== PRIOR ENTRY ===\n');
        parts.push(String(priorContent));
    }

    if (Array.isArray(previousSummaries) && previousSummaries.length > 0) {
        parts.push('\n=== PREVIOUS SCENE CONTEXT (DO NOT SUMMARIZE) ===\n');
        parts.push('These are previous memories for context only. Do NOT include them in your new output.\n\n');
        previousSummaries.forEach((m, i) => {
            parts.push(`Context ${i + 1} - ${m.title || 'Memory'}:\n`);
            parts.push(`${m.content || ''}\n`);
            if (Array.isArray(m.keywords) && m.keywords.length) {
                parts.push(`Keywords: ${m.keywords.join(', ')}\n`);
            }
            parts.push('\n');
        });
        parts.push('=== END PREVIOUS SCENE CONTEXT ===\n');
    }

    const sceneText = compiledScene ? toReadableText(compiledScene) : '';
    parts.push('\n=== SCENE TEXT ===\n');
    parts.push(sceneText);

    if (responseFormat && String(responseFormat).trim()) {
        parts.push('\n=== RESPONSE FORMAT ===\n');
        parts.push(applySidePromptMacros(responseFormat, runtimeMacros).trim());
    }

    const finalPrompt = parts.join('');
    const useRegex = !!(extension_settings?.STMemoryBooks?.moduleSettings?.useRegex);
    return useRegex ? getRegexedString(finalPrompt, regex_placement.USER_INPUT, { isPrompt: true }) : finalPrompt;
}

// ─── LLM Calling ──────────────────────────────────────────────────────

function resolveConnection(tpl, defaultOverrides = null) {
    try {
        // Template-level profile override
        const idx = Number(tpl?.settings?.overrideProfileIndex);
        const useOverride = !!tpl?.settings?.overrideProfileEnabled && Number.isFinite(idx);

        if (useOverride) {
            const settings = extension_settings?.STMemoryBooks;
            const profiles = settings?.profiles || [];
            const profileIdx = (idx >= 0 && idx < profiles.length) ? idx : 0;
            const prof = profiles[profileIdx];

            if (prof?.useDynamicSTSettings || prof?.connection?.api === 'current_st') {
                const apiInfo = getCurrentApiInfo();
                const modelInfo = getUIModelSettings();
                return {
                    api: normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai'),
                    model: modelInfo.model || '',
                    temperature: modelInfo.temperature ?? 0.7,
                };
            }
            const conn = prof?.connection || {};
            return {
                api: normalizeCompletionSource(conn.api || 'openai'),
                model: conn.model || '',
                temperature: typeof conn.temperature === 'number' ? conn.temperature : 0.7,
                endpoint: conn.endpoint || null,
                apiKey: conn.apiKey || null,
                extra: conn.extra && typeof conn.extra === 'object' ? conn.extra : undefined,
            };
        }

        // Default profile or explicit overrides
        if (defaultOverrides && (defaultOverrides.api || defaultOverrides.model)) {
            return defaultOverrides;
        }

        // STMB default profile
        const settings = extension_settings?.STMemoryBooks;
        const profiles = settings?.profiles || [];
        if (profiles.length === 0) {
            const apiInfo = getCurrentApiInfo();
            const modelInfo = getUIModelSettings();
            return {
                api: normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai'),
                model: modelInfo.model || '',
                temperature: modelInfo.temperature ?? 0.7,
            };
        }

        let defIdx = Number(settings?.defaultProfile ?? 0);
        if (!Number.isFinite(defIdx) || defIdx < 0 || defIdx >= profiles.length) defIdx = 0;
        const def = profiles[defIdx];

        if (def?.useDynamicSTSettings || def?.connection?.api === 'current_st') {
            const apiInfo = getCurrentApiInfo();
            const modelInfo = getUIModelSettings();
            return {
                api: normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai'),
                model: modelInfo.model || '',
                temperature: modelInfo.temperature ?? 0.7,
            };
        }

        const conn = def?.connection || {};
        return {
            api: normalizeCompletionSource(conn.api || 'openai'),
            model: conn.model || '',
            temperature: typeof conn.temperature === 'number' ? conn.temperature : 0.7,
            endpoint: conn.endpoint || null,
            apiKey: conn.apiKey || null,
            extra: conn.extra && typeof conn.extra === 'object' ? conn.extra : undefined,
        };
    } catch (err) {
        const apiInfo = getCurrentApiInfo();
        const modelInfo = getUIModelSettings();
        console.warn(`${MODULE_NAME}: resolveConnection error; falling back to UI`, err);
        return {
            api: normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai'),
            model: modelInfo.model || '',
            temperature: modelInfo.temperature ?? 0.7,
        };
    }
}

async function runLLM(prompt, conn, options = {}) {
    const extra = (conn && typeof conn.extra === 'object' && conn.extra) ? { ...conn.extra } : {};
    const stmbMaxTokensRaw = extension_settings?.STMemoryBooks?.moduleSettings?.maxTokens;
    const stmbMaxTokens = Number.parseInt(stmbMaxTokensRaw, 10);
    if (extra.max_tokens == null && extra.max_completion_tokens == null) {
        if (Number.isFinite(stmbMaxTokens) && stmbMaxTokens > 0) {
            extra.max_tokens = stmbMaxTokens;
        } else if (oai_settings?.openai_max_tokens) {
            extra.max_tokens = oai_settings.openai_max_tokens;
        }
    }

    const { text } = await requestCompletion({
        api: conn.api,
        model: conn.model,
        prompt,
        temperature: conn.temperature ?? 0.7,
        endpoint: conn.endpoint || null,
        apiKey: conn.apiKey || null,
        extra,
        signal: options?.signal || null,
    });

    const useRegex = !!(extension_settings?.STMemoryBooks?.moduleSettings?.useRegex);
    return useRegex ? getRegexedString(text || '', regex_placement.AI_OUTPUT) : (text || '');
}

// ─── Lorebook Entry Helpers ────────────────────────────────────────────

function toNumberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getEffectiveLorebookSettings(tpl) {
    const lb = tpl?.settings?.lorebook || {};
    return {
        constVectMode: lb.constVectMode || 'blue',
        position: toNumberOr(lb.position, 2),
        orderMode: lb.orderMode === 'manual' ? 'manual' : 'auto',
        orderValue: toNumberOr(lb.orderValue, 25),
        preventRecursion: lb.preventRecursion !== false,
        delayUntilRecursion: !!lb.delayUntilRecursion,
        ignoreBudget: !!lb.ignoreBudget,
        outletName: String(lb.outletName || ''),
        entryKeywords: String(lb.entryKeywords || ''),
    };
}

function makeUpsertParams(lbs, runtimeMacros = {}) {
    const defaults = {
        vectorized: lbs.constVectMode === 'link',
        selective: true,
        order: lbs.orderMode === 'manual' ? toNumberOr(lbs.orderValue, 100) : 100,
        position: toNumberOr(lbs.position, 0),
    };
    const entryOverrides = {
        constant: lbs.constVectMode === 'blue',
        vectorized: lbs.constVectMode === 'link',
        preventRecursion: !!lbs.preventRecursion,
        delayUntilRecursion: !!lbs.delayUntilRecursion,
        ignoreBudget: !!lbs.ignoreBudget,
    };
    if (lbs.orderMode === 'manual') {
        entryOverrides.order = toNumberOr(lbs.orderValue, 100);
    }
    if (Number(lbs.position) === 7 && lbs.outletName) {
        entryOverrides.outletName = String(lbs.outletName);
    }

    // Resolve keywords
    const rawKw = String(lbs.entryKeywords || '').trim();
    if (rawKw) {
        const resolved = applySidePromptMacros(rawKw, runtimeMacros);
        const keywords = [];
        const seen = new Set();
        for (const part of resolved.split(/[\n,]+/)) {
            const token = String(part || '').trim();
            if (!token) continue;
            if (extractMacroTokens(token).length > 0) continue;
            const normalized = token.toLowerCase();
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            keywords.push(token);
        }
        if (keywords.length > 0) entryOverrides.key = keywords;
    }

    return { defaults, entryOverrides };
}

function resolveEntryTitle(tpl, runtimeMacros = {}) {
    const overrideRaw = String(tpl?.settings?.lorebook?.entryTitleOverride || '').trim();
    const fallbackBase = String(tpl?.name || '').trim() || 'Context Manager';
    let base;
    if (overrideRaw) {
        base = applySidePromptMacros(overrideRaw, runtimeMacros).trim() || fallbackBase;
    } else {
        // Include {{char}} in default title for per-character uniqueness
        const charName = runtimeMacros['{{char}}'] || '';
        base = charName ? `${charName} ${fallbackBase}` : fallbackBase;
    }
    return base.endsWith(CM_TITLE_SUFFIX) ? base : `${base}${CM_TITLE_SUFFIX}`;
}

// ─── Scene Compilation ─────────────────────────────────────────────────

async function compileRange(start, end) {
    const shouldTemporarilyUnhide = !!extension_settings?.STMemoryBooks?.moduleSettings?.unhideBeforeMemory;
    let hiddenRanges = [];

    if (shouldTemporarilyUnhide) {
        for (let i = start; i <= end && i < chat.length; i++) {
            if (chat[i]?.is_system) {
                // Simplified: just unhide whole range
                hiddenRanges.push({ start, end });
                break;
            }
        }
    }

    if (shouldTemporarilyUnhide && hiddenRanges.length > 0) {
        try {
            await executeSlashCommands(`/unhide ${start}-${end}`);
        } catch (err) {
            console.warn(`${MODULE_NAME}: /unhide command failed:`, err);
        }
    }

    try {
        const req = createSceneRequest(start, end);
        return compileScene(req);
    } finally {
        if (hiddenRanges.length > 0) {
            for (const range of hiddenRanges) {
                try {
                    await executeSlashCommands(`/hide ${range.start}-${range.end}`);
                } catch (err) {
                    console.warn(`${MODULE_NAME}: /hide restore failed:`, err);
                }
            }
        }
    }
}

function countVisibleMessagesSince(exclusiveStart, inclusiveEnd) {
    let count = 0;
    const start = Math.max(-1, Number.isFinite(exclusiveStart) ? exclusiveStart : -1);
    const end = Math.max(-1, inclusiveEnd);
    for (let i = start + 1; i <= end && i < chat.length; i++) {
        const m = chat[i];
        if (m && !m.is_system) count++;
    }
    return count;
}

// ─── Core Execution — Per-Character Loop ───────────────────────────────

async function runCMTemplate(tpl, compiledScene, defaultOverrides, runEpoch) {
    const charLorebooks = discoverCharacterLorebooks();
    if (charLorebooks.length === 0) {
        console.warn(`${MODULE_NAME}: No characters discovered for context manager.`);
        return [];
    }

    const conn = resolveConnection(tpl, defaultOverrides);
    const lbs = getEffectiveLorebookSettings(tpl);
    const results = [];
    const total = charLorebooks.length;
    let current = 0;

    for (const charInfo of charLorebooks) {
        current++;
        throwIfStmbStopped(runEpoch);

        let { characterName, lorebookName } = charInfo;

        // Handle missing lorebook
        if (!lorebookName) {
            const result = await handleMissingLorebook(characterName);
            if (result.action === 'skipped') {
                results.push({ characterName, ok: false, skipped: true });
                continue;
            }
            lorebookName = result.lorebookName;

            // If user chose to create, we need to create the world info
            if (result.action === 'created') {
                try {
                    // SillyTavern's createNewWorldInfo creates a new lorebook
                    const resp = await fetch('/api/worldinfo/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(/** @type {HeadersInit} */({})).entries()) },
                        body: JSON.stringify({ name: lorebookName }),
                    });
                    if (!resp.ok) {
                        console.error(`${MODULE_NAME}: Failed to create lorebook "${lorebookName}"`);
                        toastr.error(`Failed to create lorebook for ${characterName}`, 'STMemoryBooks');
                        results.push({ characterName, ok: false, error: 'create_failed' });
                        continue;
                    }
                } catch (err) {
                    console.error(`${MODULE_NAME}: Error creating lorebook:`, err);
                    toastr.error(`Failed to create lorebook for ${characterName}`, 'STMemoryBooks');
                    results.push({ characterName, ok: false, error: err });
                    continue;
                }
            }
        }

        // Load lorebook data
        let loreData;
        try {
            loreData = await loadWorldInfo(lorebookName);
            if (!loreData) throw new Error('null data');
        } catch (err) {
            console.warn(`${MODULE_NAME}: Failed to load lorebook "${lorebookName}" for ${characterName}; skipping.`, err);
            results.push({ characterName, lorebookName, ok: false, error: err });
            continue;
        }

        // Build per-character runtime macros
        const runtimeMacros = { '{{char}}': characterName };

        // Resolve entry title
        const entryTitle = resolveEntryTitle(tpl, runtimeMacros);

        // Read prior entry from THIS character's lorebook
        const existing = getEntryByTitle(loreData, entryTitle);
        const prior = existing?.content || '';

        // Get previous memories for context
        let prevSummaries = [];
        const pmCount = Math.max(0, Math.min(7, Number(tpl?.settings?.previousMemoriesCount ?? 0)));
        if (pmCount > 0) {
            try {
                const res = await fetchPreviousSummaries(pmCount, extension_settings, chat_metadata);
                prevSummaries = res?.summaries || [];
            } catch { /* ignore */ }
        }

        // Build prompt
        const finalPrompt = buildCMPrompt(tpl.prompt, prior, compiledScene, tpl.responseFormat, prevSummaries, runtimeMacros);

        // LLM call
        let resultText;
        const task = createStmbInFlightTask(`ContextManager:${tpl.key}:${characterName}`);
        try {
            console.log(`${MODULE_NAME}: LLM call for "${tpl.name}" / ${characterName}`, {
                api: conn.api, model: conn.model, entryTitle,
            });
            resultText = await runLLM(finalPrompt, conn, { signal: task.signal });
            task.throwIfStopped();
        } catch (err) {
            task.finish();
            if (isStmbStopError(err)) throw err;
            console.error(`${MODULE_NAME}: LLM failed for ${characterName}:`, err);
            toastr.error(`Context Manager "${tpl.name}" failed for ${characterName}: ${err.message}`, 'STMemoryBooks');
            results.push({ characterName, lorebookName, ok: false, error: err });
            continue;
        } finally {
            task.finish();
        }

        // Validate response
        if (!String(resultText ?? '').trim()) {
            console.warn(`${MODULE_NAME}: Blank response for ${characterName}; skipping.`);
            results.push({ characterName, lorebookName, ok: false, error: 'blank_response' });
            continue;
        }

        // Write to this character's lorebook
        try {
            throwIfStmbStopped(runEpoch);
            const { defaults, entryOverrides } = makeUpsertParams(lbs, runtimeMacros);
            const endId = compiledScene?.metadata?.sceneEnd ?? (chat.length - 1);
            const metadataUpdates = {
                [`STMB_cm_${tpl.key}_lastMsgId`]: endId,
                [`STMB_cm_${tpl.key}_lastRunAt`]: new Date().toISOString(),
            };
            const refreshEditor = extension_settings?.STMemoryBooks?.moduleSettings?.refreshEditor !== false;

            await upsertLorebookEntryByTitle(lorebookName, loreData, entryTitle, resultText, {
                defaults,
                entryOverrides,
                metadataUpdates,
                refreshEditor,
            });

            console.log(`${MODULE_NAME}: Written "${entryTitle}" to "${lorebookName}" (${current}/${total})`);
            toastr.success(`Context Manager "${tpl.name}" updated for ${characterName} (${current}/${total})`, 'STMemoryBooks');
            results.push({ characterName, lorebookName, ok: true });
        } catch (err) {
            if (isStmbStopError(err)) throw err;
            console.error(`${MODULE_NAME}: Upsert failed for ${characterName}:`, err);
            toastr.error(`Failed to save context for ${characterName}`, 'STMemoryBooks');
            results.push({ characterName, lorebookName, ok: false, error: err });
        }
    }

    return results;
}

// ─── Trigger: onInterval ───────────────────────────────────────────────

async function evaluateContextManagerTrackers() {
    const parentTask = createStmbInFlightTask('ContextManager:onInterval');
    const evalEpoch = parentTask.epoch;
    try {
        throwIfStmbStopped(evalEpoch);
        const disabledKeys = getChatDisabledKeys();
        const enabledInterval = listByTrigger('onInterval').filter(tpl => !disabledKeys.includes(tpl.key));
        if (enabledInterval.length === 0) return;

        const currentLast = chat.length - 1;
        if (currentLast < 0) return;

        for (const tpl of enabledInterval) {
            throwIfStmbStopped(evalEpoch);

            // Read checkpoint from first discovered character's lorebook
            const charLorebooks = discoverCharacterLorebooks();
            const firstWithBook = charLorebooks.find(c => c.lorebookName);
            let lastMsgId = -1;
            let lastRunAt = null;

            if (firstWithBook) {
                try {
                    const loreData = await loadWorldInfo(firstWithBook.lorebookName);
                    if (loreData) {
                        const title = resolveEntryTitle(tpl, { '{{char}}': firstWithBook.characterName });
                        const existing = getEntryByTitle(loreData, title);
                        lastMsgId = Number(existing?.[`STMB_cm_${tpl.key}_lastMsgId`] ?? -1);
                        const rawDate = existing?.[`STMB_cm_${tpl.key}_lastRunAt`];
                        lastRunAt = rawDate ? Date.parse(rawDate) : null;
                    }
                } catch { /* ignore */ }
            }

            // Debounce
            const debounceMs = 10_000;
            if (lastRunAt && Date.now() - lastRunAt < debounceMs) continue;

            // Count visible messages
            const effectiveLastMsgId = lastMsgId > currentLast ? -1 : lastMsgId;
            const visibleSince = countVisibleMessagesSince(effectiveLastMsgId, currentLast);
            const threshold = Math.max(1, Number(tpl?.triggers?.onInterval?.visibleMessages ?? 50));
            if (visibleSince < threshold) continue;

            // Compile scene
            const lastN = Math.max(1, Number(tpl?.settings?.lastNMessages ?? threshold));
            const boundedStart = Math.max(0, currentLast - lastN + 1);
            let compiled;
            try {
                compiled = await compileRange(boundedStart, currentLast);
            } catch (err) {
                console.warn(`${MODULE_NAME}: Interval compile failed:`, err);
                continue;
            }

            // Run per-character
            try {
                await runCMTemplate(tpl, compiled, null, evalEpoch);
            } catch (err) {
                if (isStmbStopError(err)) return;
                console.error(`${MODULE_NAME}: Interval run failed for "${tpl.name}":`, err);
            }
        }
    } catch (outer) {
        if (isStmbStopError(outer)) return;
        console.error(`${MODULE_NAME}: evaluateContextManagerTrackers fatal:`, outer);
    } finally {
        parentTask.finish();
    }
}

// ─── Trigger: onAfterMemory ────────────────────────────────────────────

async function runContextManagerAfterMemory(compiledScene, profile) {
    const parentTask = createStmbInFlightTask('ContextManager:onAfterMemory');
    const runEpoch = parentTask.epoch;
    try {
        const disabledKeys = getChatDisabledKeys();
        const enabledAfter = listByTrigger('onAfterMemory').filter(tpl => !disabledKeys.includes(tpl.key));
        if (enabledAfter.length === 0) return;

        const defaultOverrides = profile
            ? resolveConnection({ settings: {} }, profile)
            : null;

        for (const tpl of enabledAfter) {
            throwIfStmbStopped(runEpoch);
            try {
                await runCMTemplate(tpl, compiledScene, defaultOverrides, runEpoch);
            } catch (err) {
                if (isStmbStopError(err)) return;
                console.error(`${MODULE_NAME}: AfterMemory failed for "${tpl.name}":`, err);
            }
        }
    } catch (outer) {
        if (isStmbStopError(outer)) return;
        console.error(`${MODULE_NAME}: runContextManagerAfterMemory fatal:`, outer);
    } finally {
        parentTask.finish();
    }
}

// ─── Trigger: Manual Command ───────────────────────────────────────────

async function runContextManagerManual(args) {
    const parentTask = createStmbInFlightTask('ContextManager:manual');
    const runEpoch = parentTask.epoch;
    try {
        const parsed = parseSidePromptCommandInput(args);
        if (parsed.error || !parsed.name) {
            toastr.error('Context Manager name not provided. Usage: /contextmanager "Name" [X-Y or last:N]', 'STMemoryBooks');
            return '';
        }
        const { name, range, lastN } = parsed;

        const tpl = findTemplateByName(name);
        if (!tpl) {
            toastr.error('Context Manager template not found. Check name.', 'STMemoryBooks');
            return '';
        }

        const currentLast = chat.length - 1;
        if (currentLast < 0) {
            toastr.error('No messages available.', 'STMemoryBooks');
            return '';
        }

        // Compile scene
        let compiled;
        if (lastN) {
            const n = Math.max(1, Math.min(lastN, currentLast + 1));
            const lastNStart = currentLast - n + 1;
            try {
                compiled = await compileRange(lastNStart, currentLast);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange failed:`, err);
                toastr.error('Failed to compile messages for /contextmanager', 'STMemoryBooks');
                return '';
            }
        } else if (range) {
            const m = String(range).trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
            if (!m) {
                toastr.error('Invalid range format. Use X-Y', 'STMemoryBooks');
                return '';
            }
            const start = parseInt(m[1], 10);
            const end = parseInt(m[2], 10);
            if (!(start >= 0 && end >= start && end < chat.length)) {
                toastr.error('Invalid message range', 'STMemoryBooks');
                return '';
            }
            try {
                compiled = await compileRange(start, end);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange failed:`, err);
                toastr.error('Failed to compile range', 'STMemoryBooks');
                return '';
            }
        } else {
            const defaultN = Math.max(1, Number(tpl?.settings?.lastNMessages ?? 50));
            const autoStart = Math.max(0, currentLast - defaultN + 1);
            try {
                compiled = await compileRange(autoStart, currentLast);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange failed:`, err);
                toastr.error('Failed to compile messages', 'STMemoryBooks');
                return '';
            }
        }

        await runCMTemplate(tpl, compiled, null, runEpoch);
        return '';
    } catch (outer) {
        if (isStmbStopError(outer)) return '';
        console.error(`${MODULE_NAME}: runContextManagerManual fatal:`, outer);
        return '';
    } finally {
        parentTask.finish();
    }
}

// ─── Initialization ────────────────────────────────────────────────────

export async function initContextManager() {
    console.log(`${MODULE_NAME}: Initializing Context Manager`);

    // Ensure storage exists
    getSettings();

    // Register event listeners for interval triggers
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        try {
            await evaluateContextManagerTrackers();
        } catch (err) {
            if (!isStmbStopError(err)) {
                console.error(`${MODULE_NAME}: Error in MESSAGE_RECEIVED handler:`, err);
            }
        }
    });

    eventSource.on(event_types.GROUP_WRAPPER_FINISHED, async () => {
        try {
            await evaluateContextManagerTrackers();
        } catch (err) {
            if (!isStmbStopError(err)) {
                console.error(`${MODULE_NAME}: Error in GROUP_WRAPPER_FINISHED handler:`, err);
            }
        }
    });

    // Listen for after-memory event (emitted by index.js)
    window.addEventListener('stmb-memory-created', async (e) => {
        try {
            const { compiledScene, profile } = e.detail || {};
            await runContextManagerAfterMemory(compiledScene, profile);
        } catch (err) {
            if (!isStmbStopError(err)) {
                console.error(`${MODULE_NAME}: Error in stmb-memory-created handler:`, err);
            }
        }
    });

    // Register slash command
    const cmCmd = SlashCommand.fromProps({
        name: 'contextmanager',
        callback: (namedArgs, unnamedArgs) => runContextManagerManual(String(unnamedArgs || '')),
        rawQuotes: true,
        helpString: 'Run a Context Manager template. Usage: /contextmanager "Name" [X-Y or last:N]',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Quoted template name, optionally followed by X-Y range or last:N',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
    });
    SlashCommandParser.addCommandObject(cmCmd);

    console.log(`${MODULE_NAME}: Context Manager initialized`);
}
