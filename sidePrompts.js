import { chat, chat_metadata, characters, name2, this_chid, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { METADATA_KEY, world_names, loadWorldInfo, saveWorldInfo, createNewWorldInfo } from '../../../world-info.js';
import { executeSlashCommands } from '../../../slash-commands.js';
import { selected_group, groups } from '../../../group-chats.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { escapeHtml } from '../../../utils.js';
import { getSceneMarkers } from './sceneManager.js';
import { createSceneRequest, compileScene, toReadableText } from './chatcompile.js';
import { getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource, resolveEffectiveConnectionFromProfile, resolveManualLorebookNames, clampInt, createStmbInFlightTask, isStmbStopError, getStmbStopEpoch, throwIfStmbStopped } from './utils.js';
import { applySelectedRegex, requestCompletion } from './stmemory.js';
import { listByTrigger, findTemplateByName } from './sidePromptsManager.js';
import { upsertLorebookEntryByTitle, upsertLorebookEntriesBatch, getEntryByTitle } from './addlore.js';
import { fetchPreviousSummaries, showMemoryPreviewPopup } from './confirmationPopup.js';
import { t as __st_t_tag, translate } from '../../../i18n.js';
import { oai_settings } from '../../../openai.js';
import { applySidePromptMacros, collectTemplateRuntimeMacros, extractMacroTokens, parseSidePromptCommandInput } from './sidePromptMacros.js';
import { tr } from './i18nHelpers.js';
import { validateLorebookRequirement } from './lorebookValidation.js';
import { SIDE_PROMPT } from './constants.js';


const MODULE_NAME = 'STMemoryBooks-SidePrompts';
let hasShownSidePromptRangeTip = false;

// Module-level debug flag — set to true by /sideprompt -debug, reset after run
let _moduleDebug = false;
function _dbg(...args) {
    if (_moduleDebug) console.log(`%c[STMB-DEBUG]`, 'color: #ff9800; font-weight: bold;', ...args);
}

/**
 * Get current chat ID for chat-change guards.
 * @returns {string|null}
 */
function _getChatId() {
    try {
        const ctx = getContext();
        return ctx?.chatId || (typeof window.getCurrentChatId === 'function' ? window.getCurrentChatId() : null);
    } catch { return null; }
}

/**
 * Throw if the chat changed since the run started.
 * @param {string|null} startChatId
 */
function throwIfChatChanged(startChatId) {
    if (startChatId && _getChatId() !== startChatId) {
        console.warn(`${MODULE_NAME}: Chat changed during side prompt run (was: ${startChatId}, now: ${_getChatId()}). Aborting.`);
        throw new StmbChatChangedError();
    }
}

class StmbChatChangedError extends Error {
    constructor() { super('Chat changed during side prompt execution'); this.name = 'StmbChatChangedError'; }
}

/** Check if error is a stop or chat-change error (both should abort silently) */
function isSidePromptAbortError(err) {
    return isStmbStopError(err) || err instanceof StmbChatChangedError;
}

/**
 * Returns the set of template keys disabled for the current chat via per-chat overrides.
 * @returns {string[]}
 */
function getChatDisabledKeys() {
    return getSceneMarkers()?.disabledSidePrompts ?? [];
}

/**
 * Check whether a template has per-character mode enabled.
 */
function isPerCharacterTemplate(tpl) {
    return !!tpl?.settings?.perCharacter;
}

/**
 * Get a character's attached lorebook name from their character data.
 * SillyTavern stores this in character.data.extensions.world.
 * @param {Object} char - Character object from SillyTavern's characters array
 * @returns {string|null}
 */
function getCharacterLorebookName(char) {
    _dbg(`getCharacterLorebookName for "${char?.name}":`, {
        'data.extensions.world': char?.data?.extensions?.world || '(not set)',
        'data.character_book': char?.data?.character_book ? '(present)' : '(not set)',
        'data.extensions': char?.data?.extensions ? Object.keys(char.data.extensions) : '(no extensions)',
    });

    // Primary: ST stores the character's attached lorebook in data.extensions.world
    const worldName = char?.data?.extensions?.world;
    if (worldName && typeof worldName === 'string' && worldName.trim()) {
        const name = worldName.trim();
        if (world_names?.includes(name)) return name;
        _dbg(`Lorebook "${name}" from character data not found in world_names`);
    }
    return null;
}

/**
 * Discover all characters in the current chat with their lorebook info.
 * For group chats: returns all group members.
 * For single chats: returns the single character.
 * @returns {Array<{ name: string, avatar: string, lorebook: string|null }>}
 */
function discoverChatCharacters() {
    const result = [];
    const isGroupChat = !!selected_group;

    if (isGroupChat) {
        const group = groups?.find(x => x.id === selected_group);
        if (group?.members?.length) {
            for (const memberAvatar of group.members) {
                const char = characters?.find(c => c.avatar === memberAvatar);
                if (char?.name) {
                    result.push({
                        name: char.name,
                        avatar: memberAvatar,
                        lorebook: getCharacterLorebookName(char) || findCharacterLorebookByName(char.name),
                    });
                }
            }
        }
    } else {
        // Single character chat
        let charName = null;
        let charAvatar = null;
        let char = null;
        if (this_chid !== undefined && characters?.[this_chid]) {
            char = characters[this_chid];
            charName = char.name;
            charAvatar = char.avatar;
        } else if (name2 && String(name2).trim()) {
            charName = String(name2).trim();
        }
        if (charName) {
            result.push({
                name: charName,
                avatar: charAvatar || '',
                lorebook: (char ? getCharacterLorebookName(char) : null) || findCharacterLorebookByName(charName),
            });
        }
    }

    _dbg('discoverChatCharacters result:', result.map(c => ({ name: c.name, lorebook: c.lorebook || '(none)' })));
    return result;
}

/**
 * Fallback: find a lorebook whose name starts with or closely matches the character's name.
 * Excludes the STMB chat-bound lorebook to avoid false positives on shared names.
 * @param {string} charName
 * @returns {string|null}
 */
function findCharacterLorebookByName(charName) {
    if (!charName || !Array.isArray(world_names)) return null;
    const lower = charName.toLowerCase();
    // Exclude the STMB chat-bound lorebook — it often contains character names
    const chatBoundLb = chat_metadata?.[METADATA_KEY] || null;
    const candidates = world_names.filter(n => n !== chatBoundLb);
    // Prefer exact "starts with" match (e.g., "Shilpa Lorebook" for "Shilpa")
    return candidates.find(n => n.toLowerCase().startsWith(lower)) || null;
}

/**
 * Resolve the target lorebook for a per-character upsert.
 * Priority: character's own lorebook > default STMB lorebook.
 * @param {{ name: string, lorebook: string|null }} charTarget
 * @param {{ name: string, data: any }} defaultLore - The STMB chat-bound lorebook
 * @returns {Promise<{ name: string, data: any }>}
 */
async function resolvePerCharacterLorebook(charTarget, defaultLore) {
    // Check persisted mapping first (from prior user selection)
    const settings = extension_settings?.STMemoryBooks;
    const charLorebookMap = settings?.characterLorebookMap || {};
    const persistedName = charLorebookMap[charTarget.name];
    if (persistedName && world_names?.includes(persistedName)) {
        try {
            const data = await loadWorldInfo(persistedName);
            if (data) return { name: persistedName, data };
        } catch {}
    }

    // Use character's attached lorebook
    if (charTarget?.lorebook) {
        if (charTarget.lorebook === defaultLore.name) return defaultLore;
        try {
            const data = await loadWorldInfo(charTarget.lorebook);
            if (data) return { name: charTarget.lorebook, data };
        } catch (err) {
            console.warn(`${MODULE_NAME}: Failed to load character lorebook "${charTarget.lorebook}" for ${charTarget.name}; falling back to default.`, err);
        }
    }

    // No lorebook found — prompt user to select or create one
    const result = await promptCharacterLorebookSelection(charTarget.name);
    if (result) {
        // Persist the mapping so we don't ask again
        if (!settings.characterLorebookMap) settings.characterLorebookMap = {};
        settings.characterLorebookMap[charTarget.name] = result.name;
        saveSettingsDebounced();
        charTarget.lorebook = result.name;
        return result;
    }

    // User dismissed — return null to signal skip
    return null;
}

/**
 * Resolve lorebooks for all per-character targets upfront (before LLM calls).
 * Prompts the user for any character missing a lorebook.
 * Returns only characters with a resolved lorebook; skipped characters are excluded.
 * @param {Array<{ name: string, avatar: string, lorebook: string|null }>} charTargets
 * @param {{ name: string, data: any }} defaultLore
 * @returns {Promise<Array<{ charTarget: object, lore: { name: string, data: any } }>>}
 */
async function resolveAllPerCharacterLorebooks(charTargets, defaultLore) {
    const resolved = [];
    for (const charTarget of charTargets) {
        const lore = await resolvePerCharacterLorebook(charTarget, defaultLore);
        if (lore) {
            resolved.push({ charTarget, lore });
        } else {
            console.log(`${MODULE_NAME}: Skipping character "${charTarget.name}" — no lorebook selected.`);
            toastr.warning(`Skipping "${charTarget.name}" — no lorebook selected.`, 'STMemoryBooks');
        }
    }
    return resolved;
}

/**
 * Prompt user to select an existing lorebook or create a new one for a character.
 * @param {string} charName
 * @returns {Promise<{ name: string, data: any }|null>}
 */
async function promptCharacterLorebookSelection(charName) {
    const availableLorebooks = Array.isArray(world_names) ? world_names : [];
    const lorebookOptions = availableLorebooks.map(n =>
        `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`
    ).join('');

    const defaultNewName = `${charName} Lorebook`;
    const content = `
        <h3>${escapeHtml(translate('Character Lorebook Required', 'STMemoryBooks_CharLorebookRequired'))}</h3>
        <p>${escapeHtml(translate('No lorebook found for', 'STMemoryBooks_NoLorebookFoundFor'))} <strong>${escapeHtml(charName)}</strong>.</p>
        <p>${escapeHtml(translate('Per-character mode writes entries to each character\'s own lorebook. Select an existing one or create a new one.', 'STMemoryBooks_PerCharLorebookExplain'))}</p>
        <div style="margin: 12px 0;">
            <label>
                <input type="radio" name="stmb-char-lb-choice" value="existing" checked>
                ${escapeHtml(translate('Use existing lorebook:', 'STMemoryBooks_UseExistingLorebook'))}
            </label>
            <select id="stmb-char-lb-select" class="text_pole" style="margin-top: 4px;">
                ${lorebookOptions || `<option disabled>${escapeHtml(translate('No lorebooks available', 'STMemoryBooks_NoLorebooksAvailable'))}</option>`}
            </select>
        </div>
        <div style="margin: 12px 0;">
            <label>
                <input type="radio" name="stmb-char-lb-choice" value="create">
                ${escapeHtml(translate('Create new lorebook:', 'STMemoryBooks_CreateNewLorebook'))}
            </label>
            <input type="text" id="stmb-char-lb-new-name" class="text_pole" value="${escapeHtml(defaultNewName)}" style="margin-top: 4px;">
        </div>
        <small class="opacity50p">${escapeHtml(translate('This choice is remembered and won\'t be asked again for this character.', 'STMemoryBooks_ChoiceRemembered'))}</small>
    `;

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: translate('Confirm', 'STMemoryBooks_Confirm'),
        cancelButton: translate('Skip', 'STMemoryBooks_Skip'),
        wide: false,
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    const dlg = popup.dlg;
    const choice = dlg.querySelector('input[name="stmb-char-lb-choice"]:checked')?.value;

    if (choice === 'create') {
        const newName = dlg.querySelector('#stmb-char-lb-new-name')?.value?.trim();
        if (!newName) {
            toastr.error(translate('Lorebook name cannot be empty.', 'STMemoryBooks_LorebookNameEmpty'), 'STMemoryBooks');
            return null;
        }
        try {
            const created = await createNewWorldInfo(newName);
            if (created) {
                const data = await loadWorldInfo(newName);
                if (data) {
                    toastr.success(`Created lorebook "${newName}" for ${charName}`, 'STMemoryBooks');
                    return { name: newName, data };
                }
            }
        } catch (err) {
            console.error(`${MODULE_NAME}: Failed to create lorebook "${newName}":`, err);
            toastr.error(`Failed to create lorebook "${newName}"`, 'STMemoryBooks');
        }
        return null;
    }

    // Existing lorebook
    const selectedName = dlg.querySelector('#stmb-char-lb-select')?.value;
    if (!selectedName || !world_names?.includes(selectedName)) {
        toastr.error(translate('No valid lorebook selected.', 'STMemoryBooks_NoValidLorebookSelected'), 'STMemoryBooks');
        return null;
    }
    try {
        const data = await loadWorldInfo(selectedName);
        if (data) return { name: selectedName, data };
    } catch (err) {
        console.error(`${MODULE_NAME}: Failed to load lorebook "${selectedName}":`, err);
    }
    return null;
}

/**
 * Build per-character runtime macros by injecting {{charname}} into existing macros.
 * @param {string} charName
 * @param {Record<string,string>} baseMacros
 * @returns {Record<string,string>}
 */
function buildPerCharacterMacros(charName, baseMacros = {}) {
    return {
        ...baseMacros,
        '{{charname}}': charName,
        '{{char}}': charName, // Override {{char}} so per-character templates resolve to this character
    };
}

/**
 * Get a per-character entry title by appending character name to the unified title.
 * @param {string} baseTitle - The unified side prompt title
 * @param {string} charName
 * @returns {string}
 */
function getPerCharacterTitle(baseTitle, charName) {
    const suffix = getSidePromptTitleSuffix();
    const stripped = baseTitle.endsWith(suffix) ? baseTitle.slice(0, -suffix.length) : baseTitle;
    return `${stripped} [${charName}]${suffix}`;
}

// Serialize preview popups to avoid overlap; enqueue in order of receipt
let previewQueue = Promise.resolve();
function enqueuePreview(task) {
    previewQueue = previewQueue.then(task).catch(err => {
        console.warn(`${MODULE_NAME}: preview task failed`, err);
    });
    return previewQueue;
}

/**
 * Shared lorebook requirement for side prompt execution.
 * @returns {Promise<{ name: string, data: any }>}
 */
async function requireLorebookStrict() {
    const validation = await validateLorebookRequirement({
        createContext: 'side-prompt',
    });

    if (!validation?.valid || !validation?.data || !validation?.name) {
        if (!validation?.handled && validation?.error) {
            toastr.error(validation.error, 'STMemoryBooks');
        }
        throw new Error(validation?.error || translate('No valid lorebook available.', 'STMemoryBooks_Error_NoValidLorebookAvailable'));
    }

    return { name: validation.name, data: validation.data };
}

/**
 * Resolve the list of target lorebooks for a side prompt template.
 * Returns an array of { name, data } objects.
 *
 * If `tpl.settings.lorebookOverride` is enabled and contains valid lorebook names,
 * each lorebook is loaded and returned. If the override name matches the default
 * lorebook it is reused without a redundant fetch. On any failure (all names invalid,
 * load errors) the function falls back to [defaultLore] and logs a warning.
 *
 * If the override is disabled, [defaultLore] is returned immediately (single-element
 * array so all callers can uniformly iterate).
 *
 * @param {object} tpl - Side prompt template object
 * @param {{ name: string, data: any }} defaultLore - Default lorebook from requireLorebookStrict
 * @returns {Promise<Array<{ name: string, data: any }>>}
 */
async function resolveLorebooksForTemplate(tpl, defaultLore) {
    const override = tpl?.settings?.lorebookOverride;
    if (!override?.enabled || !Array.isArray(override.lorebookNames) || override.lorebookNames.length === 0) {
        return [defaultLore];
    }

    const validNames = [...new Set(override.lorebookNames.filter(n => typeof n === 'string' && n.trim() && world_names?.includes(n)))];
    if (validNames.length === 0) {
        console.warn(`${MODULE_NAME}: lorebookOverride enabled for "${tpl.name}" but no valid lorebook names found; falling back to default.`);
        return [defaultLore];
    }

    const results = [];
    for (const name of validNames) {
        // Reuse already-loaded default to avoid double fetch
        if (name === defaultLore.name) {
            results.push(defaultLore);
            continue;
        }
        try {
            const data = await loadWorldInfo(name);
            if (!data) throw new Error('null data returned');
            results.push({ name, data });
        } catch (err) {
            console.warn(`${MODULE_NAME}: Failed to load override lorebook "${name}" for "${tpl.name}"; skipping.`, err);
        }
    }

    if (results.length === 0) {
        console.warn(`${MODULE_NAME}: All override lorebooks failed to load for "${tpl.name}"; falling back to default.`);
        return [defaultLore];
    }

    return results;
}

/**
 * Count non-system (visible) messages between exclusiveStart and inclusiveEnd indices
 */
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

/**
 * Capture contiguous hidden ranges so a temporary /unhide can be restored.
 */
function collectHiddenRanges(start, end) {
    const ranges = [];
    let rangeStart = null;

    for (let i = start; i <= end && i < chat.length; i++) {
        const isHidden = !!chat[i]?.is_system;
        if (isHidden) {
            if (rangeStart === null) rangeStart = i;
            continue;
        }
        if (rangeStart !== null) {
            ranges.push({ start: rangeStart, end: i - 1 });
            rangeStart = null;
        }
    }

    if (rangeStart !== null) {
        ranges.push({ start: rangeStart, end: end });
    }

    return ranges;
}

/**
 * Restore previously hidden ranges after a temporary /unhide.
 */
async function restoreHiddenRanges(hiddenRanges) {
    for (const range of hiddenRanges) {
        try {
            await executeSlashCommands(`/hide ${range.start}-${range.end}`);
        } catch (err) {
            console.warn(`${MODULE_NAME}: /hide command failed while restoring hidden range ${range.start}-${range.end}:`, err);
        }
    }
}

/**
 * Compile a scene safely for [start, end], optionally unhiding the range first
 * when the global unhide-before-memory setting is enabled.
 */
async function compileRange(start, end) {
    const shouldTemporarilyUnhide = !!extension_settings?.STMemoryBooks?.moduleSettings?.unhideBeforeMemory;
    const hiddenRanges = shouldTemporarilyUnhide ? collectHiddenRanges(start, end) : [];

    if (shouldTemporarilyUnhide && hiddenRanges.length > 0) {
        try {
            await executeSlashCommands(`/unhide ${start}-${end}`);
        } catch (err) {
            console.warn(`${MODULE_NAME}: /unhide command failed or unavailable:`, err);
        }
    }

    try {
        const req = createSceneRequest(start, end);
        return compileScene(req);
    } finally {
        if (hiddenRanges.length > 0) {
            await restoreHiddenRanges(hiddenRanges);
        }
    }
}

/**
 * Build a plain prompt by combining template prompt + prior content + compiled scene text
 */
function buildPrompt(templatePrompt, priorContent, compiledScene, responseFormat, previousSummaries = [], runtimeMacros = {}) {
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
    // Derive scene text from the compiled scene here to keep a single source of truth
    const sceneText = compiledScene ? toReadableText(compiledScene) : '';
    parts.push('\n=== SCENE TEXT ===\n');
    parts.push(sceneText);
    if (responseFormat && String(responseFormat).trim()) {
        parts.push('\n=== RESPONSE FORMAT ===\n');
        parts.push(applySidePromptMacros(responseFormat, runtimeMacros).trim());
    }
    const finalPrompt = parts.join('');

    // Apply the same explicit outgoing regex selection flow used by memories.
    try {
        const useRegex = !!(extension_settings?.STMemoryBooks?.moduleSettings?.useRegex);
        const selectedKeys = extension_settings?.STMemoryBooks?.moduleSettings?.selectedRegexOutgoing;
        if (useRegex && Array.isArray(selectedKeys) && selectedKeys.length > 0) {
            return applySelectedRegex(finalPrompt, selectedKeys);
        }
    } catch (e) {
        console.warn('STMemoryBooks: sideprompt outgoing regex application failed', e);
    }

    return finalPrompt;
}

/**
 * Perform LLM call
 * - By default uses current ST UI settings
 * - If overrides are provided, uses the given api/model/temperature
 */
async function runLLM(prompt, overrides = null, options = {}) {
    // Determine connection
    let api, model, temperature, endpoint, apiKey;

    if (overrides && (overrides.api || overrides.model)) {
        api = normalizeCompletionSource(overrides.api || 'openai');
        model = overrides.model || '';
        temperature = typeof overrides.temperature === 'number' ? overrides.temperature : 0.7;
        endpoint = overrides.endpoint || null;
        apiKey = overrides.apiKey || null;
        console.debug(`${MODULE_NAME}: runLLM using overrides api=${api} model=${model} temp=${temperature}`);
    } else {
        const apiInfo = getCurrentApiInfo();
        const modelInfo = getUIModelSettings();
        api = normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai');
        model = modelInfo.model || '';
        temperature = modelInfo.temperature ?? 0.7;
        console.debug(`${MODULE_NAME}: runLLM using UI settings api=${api} model=${model} temp=${temperature}`);
    }

    const extra = (overrides && typeof overrides.extra === 'object' && overrides.extra)
        ? { ...overrides.extra }
        : {};
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
        api,
        model,
        prompt,
        temperature,
        endpoint,
        apiKey,
        extra,
        signal: options?.signal || null,
    });
    
    // Apply the same explicit incoming regex selection flow used by memories.
    try {
        const useRegex = !!(extension_settings?.STMemoryBooks?.moduleSettings?.useRegex);
        const selectedKeys = extension_settings?.STMemoryBooks?.moduleSettings?.selectedRegexIncoming;
        if (useRegex && Array.isArray(selectedKeys) && selectedKeys.length > 0) {
            return applySelectedRegex(text || '', selectedKeys);
        }
    } catch (e) {
        console.warn('STMemoryBooks: sideprompt incoming regex application failed', e);
    }

    return text || '';
}

/**
 * Resolve which connection to use for side prompts, honoring user defaults.
 * - If a profile is provided with effectiveConnection/connection, use it.
 * - Otherwise, use the default memory profile from settings:
 *   - If default is dynamic "Current SillyTavern Settings", mirror current UI settings.
 *   - Else use the stored connection of that profile.
 * Fallback to UI settings only if settings are missing/invalid.
 * @returns {{api: string, model: string, temperature: number, endpoint?: string|null, apiKey?: string|null, extra?: Record<string,any>|undefined}} The resolved connection object.
 */
function resolveSidePromptConnection(profile = null, options = {}) {
    try {
        // Highest priority: explicit profile object (e.g., memory generation profile)
        if (profile && (profile.effectiveConnection || profile.connection)) {
            const rawConn = profile.effectiveConnection || profile.connection || {};
            const conn = resolveEffectiveConnectionFromProfile(profile);
            const { api, model, temperature, endpoint, apiKey } = conn;
            const extra = rawConn && typeof rawConn.extra === 'object' && rawConn.extra ? rawConn.extra : undefined;
            console.debug(`${MODULE_NAME}: resolveSidePromptConnection using provided profile api=${api} model=${model} temp=${temperature}`);
            return { api, model, temperature, endpoint, apiKey, extra };
        }

        const settings = extension_settings?.STMemoryBooks;
        const profiles = settings?.profiles || [];
        let idxOverride = options && Number.isFinite(options.overrideProfileIndex) ? Number(options.overrideProfileIndex) : null;

        // If a template-specified override index is provided, use it
        if (idxOverride !== null && profiles.length > 0) {
            if (idxOverride < 0 || idxOverride >= profiles.length) idxOverride = 0;
            const over = profiles[idxOverride];
            if (over?.useDynamicSTSettings || (over?.connection?.api === 'current_st')) {
                // Dynamic profile: mirror current UI
                const apiInfo = getCurrentApiInfo();
                const modelInfo = getUIModelSettings();
                const api = normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai');
                const model = modelInfo.model || '';
                const temperature = modelInfo.temperature ?? 0.7;
                console.debug(`${MODULE_NAME}: resolveSidePromptConnection using UI via template override profile index=${idxOverride} api=${api} model=${model} temp=${temperature}`);
                return { api, model, temperature };
            } else {
                const conn = over?.connection || {};
                const api = normalizeCompletionSource(conn.api || 'openai');
                const model = conn.model || '';
                const temperature = typeof conn.temperature === 'number' ? conn.temperature : 0.7;
                const endpoint = conn.endpoint || null;
                const apiKey = conn.apiKey || null;
                const extra = conn && typeof conn.extra === 'object' && conn.extra ? conn.extra : undefined;
                console.debug(`${MODULE_NAME}: resolveSidePromptConnection using template override profile index=${idxOverride} api=${api} model=${model} temp=${temperature}`);
                return { api, model, temperature, endpoint, apiKey, extra };
            }
        }

        // Otherwise: use STMB default profile (may be dynamic)
        let idx = Number(settings?.defaultProfile ?? 0);
        if (!Array.isArray(profiles) || profiles.length === 0) {
            // No profiles available: mirror UI
            const apiInfo = getCurrentApiInfo();
            const modelInfo = getUIModelSettings();
            const api = normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai');
            const model = modelInfo.model || '';
            const temperature = modelInfo.temperature ?? 0.7;
            console.debug(`${MODULE_NAME}: resolveSidePromptConnection fallback to UI (no profiles) api=${api} model=${model} temp=${temperature}`);
            return { api, model, temperature };
        }
        if (!Number.isFinite(idx) || idx < 0 || idx >= profiles.length) idx = 0;

        const def = profiles[idx];
        if (def?.useDynamicSTSettings || (def?.connection?.api === 'current_st')) {
            // Default memory profile is "Current SillyTavern Settings" => use UI
            const apiInfo = getCurrentApiInfo();
            const modelInfo = getUIModelSettings();
            const api = normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai');
            const model = modelInfo.model || '';
            const temperature = modelInfo.temperature ?? 0.7;
            console.debug(`${MODULE_NAME}: resolveSidePromptConnection using UI via dynamic default profile api=${api} model=${model} temp=${temperature}`);
            return { api, model, temperature };
        } else {
            const conn = def?.connection || {};
            const api = normalizeCompletionSource(conn.api || 'openai');
            const model = conn.model || '';
            const temperature = typeof conn.temperature === 'number' ? conn.temperature : 0.7;
            const endpoint = conn.endpoint || null;
            const apiKey = conn.apiKey || null;
            const extra = conn && typeof conn.extra === 'object' && conn.extra ? conn.extra : undefined;
            console.debug(`${MODULE_NAME}: resolveSidePromptConnection using default profile api=${api} model=${model} temp=${temperature}`);
            return { api, model, temperature, endpoint, apiKey, extra };
        }
    } catch (err) {
        // Ultimate fallback: UI
        const apiInfo = getCurrentApiInfo();
        const modelInfo = getUIModelSettings();
        const api = normalizeCompletionSource(apiInfo.completionSource || apiInfo.api || 'openai');
        const model = modelInfo.model || '';
        const temperature = modelInfo.temperature ?? 0.7;
        console.warn(`${MODULE_NAME}: resolveSidePromptConnection error; falling back to UI`, err);
        return { api, model, temperature };
    }
}

/**
 * Lorebook settings helpers for side prompts
 */
function toNumberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Read effective lorebook settings from a template, with safe defaults.
 * constVectMode: 'link' (vectorized, default) | 'green' (normal) | 'blue' (constant)
 * orderMode: 'auto' | 'manual' (if manual, orderValue is used)
 */
function getEffectiveLorebookSettingsForTemplate(tpl) {
    const lb = (tpl && tpl.settings && tpl.settings.lorebook) || {};
    return {
        constVectMode: lb.constVectMode || 'link',
        position: toNumberOr(lb.position, 0),
        orderMode: lb.orderMode === 'manual' ? 'manual' : 'auto',
        orderValue: toNumberOr(lb.orderValue, 100),
        preventRecursion: lb.preventRecursion !== false,
        delayUntilRecursion: !!lb.delayUntilRecursion,
        ignoreBudget: !!lb.ignoreBudget,
        outletName: String(lb.outletName || ''),
    };
}

/**
 * Build defaults (for create-time) and entryOverrides (for create+update) for upsert calls
 */
function resolveLorebookEntryKeywords(lbs, runtimeMacros = {}) {
    const rawTemplate = String(lbs?.entryKeywords || '').trim();
    if (!rawTemplate) {
        return [];
    }

    const resolved = applySidePromptMacros(rawTemplate, runtimeMacros);
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

    return keywords;
}

function makeUpsertParamsFromLorebook(lbs, runtimeMacros = {}) {
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
    const keywords = resolveLorebookEntryKeywords(lbs, runtimeMacros);
    if (keywords.length > 0) {
        entryOverrides.key = keywords;
    }
    return { defaults, entryOverrides };
}

function getSidePromptTitleSuffix() {
    return ' (STMB SidePrompt)';
}

function getResolvedSidePromptTitleBase(tpl, runtimeMacros = {}) {
    const overrideRaw = String(tpl?.settings?.lorebook?.entryTitleOverride || '').trim();
    const fallbackBase = String(tpl?.name || '').trim() || 'Side Prompt';
    if (!overrideRaw) {
        return fallbackBase;
    }

    const resolved = applySidePromptMacros(overrideRaw, runtimeMacros).trim();
    return resolved || fallbackBase;
}

function getUnifiedSidePromptTitle(tpl, runtimeMacros = {}) {
    const baseTitle = getResolvedSidePromptTitleBase(tpl, runtimeMacros);
    const suffix = getSidePromptTitleSuffix();
    return baseTitle.endsWith(suffix) ? baseTitle : `${baseTitle}${suffix}`;
}

function getSidePromptLookupTitles(tpl, runtimeMacros = {}, fallbackKinds = []) {
    const titles = [getUnifiedSidePromptTitle(tpl, runtimeMacros)];
    const hasTitleOverride = !!String(tpl?.settings?.lorebook?.entryTitleOverride || '').trim();
    if (!hasTitleOverride) {
        for (const kind of fallbackKinds) {
            if (kind === 'plotpoints') {
                titles.push(`${tpl.name} (STMB Plotpoints)`);
            } else if (kind === 'scoreboard') {
                titles.push(`${tpl.name} (STMB Scoreboard)`);
            } else if (kind === 'tracker') {
                titles.push(`${tpl.name} (STMB Tracker)`);
            }
        }
    }
    return titles;
}

function findFirstLoreEntryByTitle(loreData, titles = []) {
    for (const title of titles) {
        const entry = getEntryByTitle(loreData, title);
        if (entry) return entry;
    }
    return null;
}

async function prepareSidePromptRun({ tpl, loreData, compiledScene, defaultOverrides = null, fallbackKinds = [], runtimeMacros = {}, additionalTitles = [] }) {
    const unifiedTitle = getUnifiedSidePromptTitle(tpl, runtimeMacros);
    const lookupTitles = [...additionalTitles, ...getSidePromptLookupTitles(tpl, runtimeMacros, fallbackKinds)];
    const existing = findFirstLoreEntryByTitle(loreData, lookupTitles);
    const prior = existing?.content || '';

    let prevSummaries = [];
    const pmCountRaw = Number(tpl?.settings?.previousMemoriesCount ?? 0);
    const pmCount = Math.max(0, Math.min(7, pmCountRaw));
    _dbg(`prepareSidePromptRun previousMemoriesCount: raw=${pmCountRaw}, clamped=${pmCount}`);
    if (pmCount > 0) {
        try {
            const res = await fetchPreviousSummaries(pmCount, extension_settings, chat_metadata);
            prevSummaries = res?.summaries || [];
            _dbg(`fetchPreviousSummaries returned ${prevSummaries.length} of ${pmCount} requested`, prevSummaries.map(s => s.title));
        } catch (err) {
            console.warn(`${MODULE_NAME}: fetchPreviousSummaries failed:`, err);
        }
    }

    const finalPrompt = buildPrompt(tpl.prompt, prior, compiledScene, tpl.responseFormat, prevSummaries, runtimeMacros);
    const idx = Number(tpl?.settings?.overrideProfileIndex);
    const useOverride = !!tpl?.settings?.overrideProfileEnabled && Number.isFinite(idx);
    const conn = useOverride
        ? resolveSidePromptConnection(null, { overrideProfileIndex: idx })
        : (defaultOverrides || resolveSidePromptConnection(null));

    return { unifiedTitle, existing, prior, finalPrompt, conn };
}

async function runSidePromptAttempt({ taskLabel, finalPrompt, conn, runEpoch }) {
    throwIfStmbStopped(runEpoch);
    const task = createStmbInFlightTask(taskLabel);
    try {
        const text = await runLLM(finalPrompt, conn, { signal: task.signal });
        task.throwIfStopped();
        return text;
    } finally {
        task.finish();
    }
}

/**
 * Determine whether a side-prompt error is worth retrying.
 * Stop/cancel and chat-change errors are never retried.
 */
function isSidePromptRetryableError(err) {
    if (isSidePromptAbortError(err)) return false;
    if (err?.name === 'TokenWarningError' || err?.name === 'InvalidProfileError') return false;
    return true;
}

/**
 * Sleep with abort support — resolves after `ms` or rejects if signal fires.
 */
function sidePromptSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, ms);
        if (!signal) return;
        if (signal.aborted) {
            clearTimeout(timeoutId);
            reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
            return;
        }
        const onAbort = () => {
            clearTimeout(timeoutId);
            reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Wrap runSidePromptAttempt with retry logic matching memory generation behaviour.
 * Retries up to SIDE_PROMPT.MAX_RETRIES on retryable errors OR blank responses,
 * with SIDE_PROMPT.RETRY_DELAY_MS delay between attempts.
 *
 * @param {object}  opts                    Same args as runSidePromptAttempt plus extras.
 * @param {string}  opts.taskLabel          Label for the in-flight task.
 * @param {string}  opts.finalPrompt        Assembled prompt text.
 * @param {object}  opts.conn               Connection/model config.
 * @param {number}  opts.runEpoch           Stop-epoch for abort checks.
 * @param {string}  opts.displayName        Human-readable name for toasts.
 * @param {string}  opts.trigger            Trigger type label (onInterval | onAfterMemory | manual).
 * @returns {Promise<string>} LLM response text (guaranteed non-blank on success).
 * @throws {Error} After all retries exhausted, or on non-retryable / abort errors.
 */
async function runSidePromptWithRetry({ taskLabel, finalPrompt, conn, runEpoch, displayName, trigger }) {
    const maxRetries = SIDE_PROMPT.MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let text;
        try {
            text = await runSidePromptAttempt({ taskLabel, finalPrompt, conn, runEpoch });
        } catch (err) {
            // Non-retryable or abort — propagate immediately
            if (!isSidePromptRetryableError(err) || attempt >= maxRetries) {
                throw err;
            }
            await _retrySidePromptDelay(taskLabel, displayName, attempt, maxRetries, runEpoch);
            continue;
        }

        // Treat blank response as retryable
        if (!String(text ?? '').trim()) {
            if (attempt >= maxRetries) {
                // All retries exhausted with blank — let caller handle via ensureSidePromptTextNotBlank
                return text;
            }
            console.warn(`${MODULE_NAME}: SidePrompt "${displayName}" returned blank (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
            await _retrySidePromptDelay(taskLabel, displayName, attempt, maxRetries, runEpoch);
            continue;
        }

        // Success with non-blank text
        if (attempt > 0) {
            console.log(`${MODULE_NAME}: SidePrompt "${displayName}" succeeded on attempt ${attempt + 1}`);
        }
        return text;
    }
}

/** Shared delay logic between retry attempts. */
async function _retrySidePromptDelay(taskLabel, displayName, attempt, maxRetries, runEpoch) {
    const delaySeconds = Math.round(SIDE_PROMPT.RETRY_DELAY_MS / 1000);
    toastr.warning(
        __st_t_tag`SidePrompt "${displayName}" failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delaySeconds}s...`,
        'STMemoryBooks',
        { timeOut: 3000 },
    );

    const task = createStmbInFlightTask(`${taskLabel}:retry-delay`);
    try {
        await sidePromptSleep(SIDE_PROMPT.RETRY_DELAY_MS, task.signal);
    } catch (sleepErr) {
        task.finish();
        if (isStmbStopError(sleepErr) || sleepErr?.name === 'AbortError') {
            throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        }
        throw sleepErr;
    }
    task.finish();
    throwIfStmbStopped(runEpoch);
}

function ensureSidePromptTextNotBlank(text, tpl, trigger) {
    if (String(text ?? '').trim()) return true;

    const name = String(tpl?.name || 'Unknown');
    console.error(`${MODULE_NAME}: SidePrompt returned blank content; skipping save`, {
        trigger,
        name,
        key: tpl?.key || null,
    });
    toastr.error(
        tr(
            'STMemoryBooks_Toast_SidePromptBlankNotSaved',
            'SidePrompt "{{name}}" returned blank content. No changes were saved.',
            { name },
        ),
        'STMemoryBooks',
    );
    return false;
}

function buildSidePromptPreviewSceneData(compiledScene) {
    return {
        sceneStart: compiledScene?.metadata?.sceneStart ?? 0,
        sceneEnd: compiledScene?.metadata?.sceneEnd ?? 0,
        messageCount: compiledScene?.metadata?.messageCount ?? (compiledScene?.messages?.length ?? 0),
    };
}

async function resolveSidePromptPreview({
    tpl,
    initialText,
    finalPrompt,
    conn,
    compiledScene,
    runEpoch,
    queuePreview = false,
    retryTaskLabel,
}) {
    let textToSave = initialText;
    const settings = extension_settings?.STMemoryBooks;
    if (!settings?.moduleSettings?.showMemoryPreviews) {
        return { approved: true, text: textToSave };
    }

    const sceneDataForPreview = buildSidePromptPreviewSceneData(compiledScene);
    const profileSettingsForPreview = { name: 'SidePrompt' };

    while (true) {
        let previewResult;
        const memoryResult = {
            extractedTitle: getUnifiedSidePromptTitle(tpl),
            content: textToSave,
            suggestedKeys: [],
        };

        if (queuePreview) {
            await enqueuePreview(async () => {
                previewResult = await showMemoryPreviewPopup(memoryResult, sceneDataForPreview, profileSettingsForPreview, { lockTitle: true });
            });
        } else {
            previewResult = await showMemoryPreviewPopup(memoryResult, sceneDataForPreview, profileSettingsForPreview, { lockTitle: true });
        }

        if (previewResult?.action === 'cancel') {
            return { approved: false, text: textToSave };
        }

        if (previewResult?.action === 'retry') {
            textToSave = await runSidePromptAttempt({
                taskLabel: retryTaskLabel,
                finalPrompt,
                conn,
                runEpoch,
            });
            continue;
        }

        if (previewResult?.action === 'edit' && previewResult.memoryData) {
            textToSave = previewResult.memoryData.content ?? textToSave;
        }

        return { approved: true, text: textToSave };
    }
}

/**
 * Evaluate tracker prompts and fire if thresholds are met
 */
export async function evaluateTrackers() {
    const parentTask = createStmbInFlightTask('SidePrompts:onInterval');
    const evalEpoch = parentTask.epoch;
    try {
        throwIfStmbStopped(evalEpoch);
        const enabledInterval = (await listByTrigger('onInterval')).filter(tpl => !getChatDisabledKeys().includes(tpl.key));
        if (!enabledInterval || enabledInterval.length === 0) return;

        // Ensure lorebook exists up-front
        const lore = await requireLorebookStrict();
        const defaultOverrides = resolveSidePromptConnection(null);

        const currentLast = chat.length - 1;
        if (currentLast < 0) return;

        for (const tpl of enabledInterval) {
            // Per-template lorebook resolution (supports lorebookOverride; falls back to default)
            const tplLores = await resolveLorebooksForTemplate(tpl, lore);

            // Read existing entry to get last checkpoint
            const lookupTitles = getSidePromptLookupTitles(tpl, {}, ['tracker']);
            const existing = findFirstLoreEntryByTitle(tplLores[0].data, lookupTitles);
            const lastMsgId = Number(
                (existing && existing[`STMB_sp_${tpl.key}_lastMsgId`]) ??
                (existing && existing.STMB_tracker_lastMsgId) ??
                -1
            );
            const lastRunAt = existing?.[`STMB_sp_${tpl.key}_lastRunAt`]
                ? Date.parse(existing[`STMB_sp_${tpl.key}_lastRunAt`])
                : (existing?.STMB_tracker_lastRunAt ? Date.parse(existing.STMB_tracker_lastRunAt) : null);
            const now = Date.now();

            // Internal debounce to prevent disk thrash (not user-configurable)
            const debounceMs = 10_000; // 10 seconds
            if (lastRunAt && now - lastRunAt < debounceMs) {
                continue;
            }

            // Count visible messages since last checkpoint
            // If lastMsgId is from a different (longer) chat, treat as no checkpoint
            const effectiveLastMsgId = lastMsgId > currentLast ? -1 : lastMsgId;
            const visibleSince = countVisibleMessagesSince(effectiveLastMsgId, currentLast);
            const threshold = Math.max(1, Number(tpl?.triggers?.onInterval?.visibleMessages ?? 50));
            if (visibleSince < threshold) {
                continue;
            }

            // Build compiled scene using the interval window (last N messages)
            // Using onInterval.visibleMessages as the window keeps the compile range
            // consistent and avoids checkpoint bleed on shared lorebooks.
            if (lastMsgId > currentLast) {
                console.warn(`${MODULE_NAME}: Interval: lastMsgId (${lastMsgId}) is beyond current chat length (${chat.length}); checkpoint likely from a different chat sharing this lorebook. Running with interval window.`);
            }
            const boundedStart = Math.max(0, currentLast - threshold + 1);

            let compiled = null;
            try {
                compiled = await compileRange(boundedStart, currentLast);
            } catch (err) {
                console.warn(`${MODULE_NAME}: Interval compile failed:`, err);
                continue;
            }

            // Per-character mode: resolve lorebooks upfront; standard mode: single run
            const perChar = isPerCharacterTemplate(tpl);
            let charWorkItems;
            if (perChar) {
                const rawChars = discoverChatCharacters();
                if (rawChars.length === 0) {
                    console.warn(`${MODULE_NAME}: Per-character template "${tpl.name}" found no characters; skipping.`);
                    continue;
                }
                charWorkItems = await resolveAllPerCharacterLorebooks(rawChars, tplLores[0]);
                if (charWorkItems.length === 0) continue;
            } else {
                charWorkItems = [{ charTarget: null, lore: null }];
            }

            for (const { charTarget, lore: charLore } of charWorkItems) {
                const runtimeMacros = charTarget ? buildPerCharacterMacros(charTarget.name) : {};

                const perCharTitleHint = charTarget
                    ? getPerCharacterTitle(getUnifiedSidePromptTitle(tpl, runtimeMacros), charTarget.name)
                    : null;

                const prepared = await prepareSidePromptRun({
                    tpl,
                    loreData: (charLore?.data) || lore.data,
                    compiledScene: compiled,
                    defaultOverrides,
                    fallbackKinds: ['tracker'],
                    runtimeMacros,
                    additionalTitles: perCharTitleHint ? [perCharTitleHint] : [],
                });

                const effectiveTitle = perCharTitleHint || prepared.unifiedTitle;

                // Call LLM with retry
                let resultText = '';
                const runEpoch = getStmbStopEpoch();
                const displayName = `${tpl.name}${charTarget ? ` (${charTarget.name})` : ''}`;
                try {
                    console.log(`${MODULE_NAME}: SidePrompt attempt`, {
                        trigger: 'onInterval',
                        name: tpl.name,
                        key: tpl.key,
                        character: charTarget?.name || null,
                        range: `${boundedStart}-${currentLast}`,
                        visibleSince,
                        threshold,
                        api: prepared.conn.api,
                        model: prepared.conn.model,
                    });
                    resultText = await runSidePromptWithRetry({
                        taskLabel: `SidePrompt:onInterval:${tpl?.key || tpl?.name || 'unknown'}${charTarget ? `:${charTarget.name}` : ''}`,
                        finalPrompt: prepared.finalPrompt,
                        conn: prepared.conn,
                        runEpoch,
                        displayName,
                        trigger: 'onInterval',
                    });
                } catch (err) {
                    if (isSidePromptAbortError(err)) return;
                    console.error(`${MODULE_NAME}: Interval sideprompt LLM failed${charTarget ? ` for ${charTarget.name}` : ''} (all attempts exhausted):`, err);
                    toastr.error(__st_t_tag`SidePrompt "${displayName}" failed after ${SIDE_PROMPT.MAX_RETRIES + 1} attempts: ${err.message}`, 'STMemoryBooks');
                    continue;
                }

                throwIfStmbStopped(runEpoch);
                if (!ensureSidePromptTextNotBlank(resultText, tpl, 'onInterval')) continue;

                // Preview gating if enabled
                try {
                    const settings = extension_settings?.STMemoryBooks;
                    if (settings?.moduleSettings?.showMemoryPreviews) {
                        const memoryResult = {
                            extractedTitle: effectiveTitle,
                            content: resultText,
                            suggestedKeys: [],
                        };
                        const sceneDataForPreview = {
                            sceneStart: compiled?.metadata?.sceneStart ?? boundedStart,
                            sceneEnd: compiled?.metadata?.sceneEnd ?? currentLast,
                            messageCount: compiled?.metadata?.messageCount ?? (compiled?.messages?.length ?? 0),
                        };
                        const profileSettingsForPreview = { name: 'SidePrompt' };
                        let previewResult;
                        await enqueuePreview(async () => {
                            previewResult = await showMemoryPreviewPopup(memoryResult, sceneDataForPreview, profileSettingsForPreview, { lockTitle: true });
                        });
                        if (previewResult?.action === 'cancel' || previewResult?.action === 'retry') {
                            console.log(`${MODULE_NAME}: SidePrompt "${tpl.name}"${charTarget ? ` (${charTarget.name})` : ''} canceled or retry requested in preview; skipping save`);
                            continue;
                        } else if (previewResult?.action === 'edit' && previewResult.memoryData) {
                            resultText = previewResult.memoryData.content ?? resultText;
                        }
                    }
                } catch (previewErr) {
                    console.warn(`${MODULE_NAME}: Preview step failed; proceeding without preview`, previewErr);
                }

                // Upsert entry into all target lorebooks; write checkpoint metadata on each
                try {
                    throwIfStmbStopped(runEpoch);
                    const lbs = getEffectiveLorebookSettingsForTemplate(tpl);
                    const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lbs, runtimeMacros);
                    // Add character name to keywords for per-character entries
                    if (charTarget && entryOverrides.key) {
                        if (!entryOverrides.key.some(k => k.toLowerCase() === charTarget.name.toLowerCase())) {
                            entryOverrides.key.push(charTarget.name);
                        }
                    } else if (charTarget) {
                        entryOverrides.key = [charTarget.name];
                    }
                    const endId = compiled?.metadata?.sceneEnd ?? currentLast;
                    const checkpointSuffix = charTarget ? `_${charTarget.name}` : '';
                    const metadataUpdates = {
                        [`STMB_sp_${tpl.key}${checkpointSuffix}_lastMsgId`]: endId,
                        [`STMB_sp_${tpl.key}${checkpointSuffix}_lastRunAt`]: new Date().toISOString(),
                        STMB_tracker_lastMsgId: endId,
                        STMB_tracker_lastRunAt: new Date().toISOString(),
                    };
                    if (charTarget) {
                        metadataUpdates.STMB_character = charTarget.name;
                    }
                    const refreshEditor = extension_settings?.STMemoryBooks?.moduleSettings?.refreshEditor !== false;

                    // Per-character: use pre-resolved lorebook; standard: use template lorebooks
                    if (charTarget && charLore) {
                        const freshData = await loadWorldInfo(charLore.name).catch(() => charLore.data);
                        await upsertLorebookEntryByTitle(charLore.name, freshData || charLore.data, effectiveTitle, resultText, {
                            defaults,
                            entryOverrides,
                            metadataUpdates,
                            refreshEditor,
                        });
                    } else {
                        for (const tplLore of tplLores) {
                            const targetData = tplLore.name === tplLores[0].name
                                ? tplLore.data
                                : (await loadWorldInfo(tplLore.name).catch(() => null));
                            if (!targetData) {
                                console.warn(`${MODULE_NAME}: Could not reload lorebook "${tplLore.name}" for write; skipping.`);
                                continue;
                            }
                            await upsertLorebookEntryByTitle(tplLore.name, targetData, effectiveTitle, resultText, {
                                defaults,
                                entryOverrides,
                                metadataUpdates,
                                refreshEditor,
                            });
                        }
                    }
                    console.log(`${MODULE_NAME}: SidePrompt success`, {
                        trigger: 'onInterval',
                        name: tpl.name,
                        key: tpl.key,
                        character: charTarget?.name || null,
                        saved: true,
                        contentChars: resultText.length,
                    });
                } catch (err) {
                    console.error(`${MODULE_NAME}: Interval sideprompt upsert failed${charTarget ? ` for ${charTarget.name}` : ''}:`, err);
                    toastr.error(__st_t_tag`Failed to update sideprompt entry "${tpl.name}"${charTarget ? ` (${charTarget.name})` : ''}`, 'STMemoryBooks');
                    continue;
                }
            }
        }
    } catch (outer) {
        if (isStmbStopError(outer)) return;
        console.error(`${MODULE_NAME}: runInterval fatal error:`, outer);
    } finally {
        parentTask.finish();
    }
}

/**
 * Run plotpoints and auto scoreboards after a memory run using the same compiled scene
 * @param {Object} compiledScene
 */
export async function runAfterMemory(compiledScene, profile = null) {
    const parentTask = createStmbInFlightTask('SidePrompts:onAfterMemory');
    const runEpoch = parentTask.epoch;
    try {
        const lore = await requireLorebookStrict();
        const enabledAfter = (await listByTrigger('onAfterMemory')).filter(tpl => !getChatDisabledKeys().includes(tpl.key));

        if (!enabledAfter || enabledAfter.length === 0) return;


        // Determine default connection to use for side prompts
        const defaultOverrides = resolveSidePromptConnection(profile);
        console.debug(`${MODULE_NAME}: runAfterMemory default overrides api=${defaultOverrides.api} model=${defaultOverrides.model} temp=${defaultOverrides.temperature}`);
        const settings = extension_settings?.STMemoryBooks;
        const refreshEditor = settings?.moduleSettings?.refreshEditor !== false;
        const showNotifications = settings?.moduleSettings?.showNotifications !== false;
        const results = [];

        const maxConcurrent = clampInt(Number(settings?.moduleSettings?.sidePromptsMaxConcurrent ?? 2),1,5);

        // Expand per-character templates into individual work items
        // Resolve lorebooks upfront so missing-lorebook prompts happen before LLM calls
        const workItems = [];
        for (const tpl of enabledAfter) {
            if (isPerCharacterTemplate(tpl)) {
                const chars = discoverChatCharacters();
                if (chars.length === 0) {
                    console.warn(`${MODULE_NAME}: Per-character template "${tpl.name}" found no characters; skipping.`);
                    continue;
                }
                const tplLoresForChar = await resolveLorebooksForTemplate(tpl, lore);
                const resolved = await resolveAllPerCharacterLorebooks(chars, tplLoresForChar[0]);
                for (const { charTarget, lore: charLore } of resolved) {
                    workItems.push({ tpl, charTarget, charLore });
                }
            } else {
                workItems.push({ tpl, charTarget: null, charLore: null });
            }
        }

        // Partition into waves of size maxConcurrent
        const waves = [];
        for (let i = 0; i < workItems.length; i += maxConcurrent) {
            waves.push(workItems.slice(i, i + maxConcurrent));
        }

        for (const wave of waves) {
            throwIfStmbStopped(runEpoch);
            // Run LLMs concurrently for this wave (scene-only prompts)
            const llmPromises = wave.map(async ({ tpl, charTarget, charLore }) => {
                const displayName = charTarget ? `${tpl.name} (${charTarget.name})` : tpl.name;
                try {
                    const runtimeMacros = charTarget ? buildPerCharacterMacros(charTarget.name) : {};
                    const tplLores = await resolveLorebooksForTemplate(tpl, lore);
                    const perCharTitleHint = charTarget
                        ? getPerCharacterTitle(getUnifiedSidePromptTitle(tpl, runtimeMacros), charTarget.name)
                        : null;
                    const prepared = await prepareSidePromptRun({
                        tpl,
                        loreData: (charLore?.data) || tplLores[0].data,
                        compiledScene,
                        defaultOverrides,
                        fallbackKinds: ['plotpoints', 'scoreboard'],
                        runtimeMacros,
                        additionalTitles: perCharTitleHint ? [perCharTitleHint] : [],
                    });
                    const effectiveTitle = perCharTitleHint || prepared.unifiedTitle;
                    console.log(`${MODULE_NAME}: SidePrompt attempt`, {
                        trigger: 'onAfterMemory',
                        name: tpl.name,
                        key: tpl.key,
                        character: charTarget?.name || null,
                        api: prepared.conn.api,
                        model: prepared.conn.model,
                    });
                    const text = await runSidePromptWithRetry({
                        taskLabel: `SidePrompt:onAfterMemory:${tpl?.key || tpl?.name || 'unknown'}${charTarget ? `:${charTarget.name}` : ''}`,
                        finalPrompt: prepared.finalPrompt,
                        conn: prepared.conn,
                        runEpoch,
                        displayName,
                        trigger: 'onAfterMemory',
                    });
                    return {
                        ok: true,
                        tpl,
                        charTarget,
                        charLore,
                        text,
                        unifiedTitle: effectiveTitle,
                        finalPrompt: prepared.finalPrompt,
                        conn: prepared.conn,
                        tplLores,
                        displayName,
                        runtimeMacros,
                    };
                } catch (e) {
                    if (!isSidePromptAbortError(e)) {
                        console.error(`${MODULE_NAME}: Wave LLM failed for "${displayName}" (all attempts exhausted):`, e);
                    }
                    return { ok: false, tpl, charTarget, error: e, cancelled: isSidePromptAbortError(e), displayName };
                }
            });

            const llmResults = await Promise.all(llmPromises.map(p => p.then(r => ({ ...r, _completedAt: performance.now() }))));
            throwIfStmbStopped(runEpoch);

            // Present previews in order of receipt
            llmResults.sort((a, b) => a._completedAt - b._completedAt);

            // Build batch items from successes (preview-gated, receipt order)
            const items = [];
            const succeededNames = [];
            for (const r of llmResults) {
                if (!r.ok) {
                    if (r.cancelled) continue;
                    results.push({ name: r.displayName || 'unknown', ok: false, error: r.error });
                    continue;
                }

                let textToSave = r.text;
                let approved = true;

                if (!ensureSidePromptTextNotBlank(textToSave, r.tpl, 'onAfterMemory')) {
                    results.push({ name: r.displayName, ok: false, error: new Error('Blank side prompt response') });
                    continue;
                }

                try {
                    throwIfStmbStopped(runEpoch);
                    const previewResult = await resolveSidePromptPreview({
                        tpl: r.tpl,
                        initialText: textToSave,
                        finalPrompt: r.finalPrompt,
                        conn: r.conn,
                        compiledScene,
                        runEpoch,
                        queuePreview: true,
                        retryTaskLabel: `SidePrompt:onAfterMemory:retry:${r.tpl?.key || r.tpl?.name || 'unknown'}${r.charTarget ? `:${r.charTarget.name}` : ''}`,
                    });
                    approved = previewResult.approved;
                    textToSave = previewResult.text;
                } catch (previewErr) {
                    if (isStmbStopError(previewErr)) return;
                    console.warn(`${MODULE_NAME}: Preview step failed; proceeding without preview`, previewErr);
                }

                if (approved) {
                    if (!ensureSidePromptTextNotBlank(textToSave, r.tpl, 'onAfterMemory')) {
                        results.push({ name: r.displayName, ok: false, error: new Error('Blank side prompt response') });
                        continue;
                    }
                    throwIfStmbStopped(runEpoch);
                    const tpl = r.tpl;
                    const lbs = getEffectiveLorebookSettingsForTemplate(tpl);
                    const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lbs, r.runtimeMacros || {});
                    // Add character name to keywords for per-character entries
                    if (r.charTarget) {
                        if (entryOverrides.key) {
                            if (!entryOverrides.key.some(k => k.toLowerCase() === r.charTarget.name.toLowerCase())) {
                                entryOverrides.key.push(r.charTarget.name);
                            }
                        } else {
                            entryOverrides.key = [r.charTarget.name];
                        }
                    }
                    const metadataUpdates = {
                        [`STMB_sp_${tpl.key}_lastRunAt`]: new Date().toISOString(),
                    };
                    if (r.charTarget) {
                        metadataUpdates.STMB_character = r.charTarget.name;
                    }
                    items.push({
                        name: r.displayName,
                        title: r.unifiedTitle,
                        content: textToSave,
                        defaults,
                        entryOverrides,
                        metadataUpdates,
                        _tplLores: r.tplLores,
                        _charTarget: r.charTarget,
                        _charLore: r.charLore,
                    });
                    succeededNames.push(r.displayName);
                } else {
                    results.push({ name: r.displayName, ok: false, error: new Error('User canceled or retry in preview') });
                }
            }

            if (items.length > 0) {
                throwIfStmbStopped(runEpoch);
                // Group items by target lorebook.
                // Per-character items route to the character's own lorebook;
                // standard items use the template's lorebook overrides or the default.
                const lorebookGroups = new Map();
                for (const item of items) {
                    if (item._charLore) {
                        const charLbName = item._charLore.name;
                        if (!lorebookGroups.has(charLbName)) lorebookGroups.set(charLbName, []);
                        lorebookGroups.get(charLbName).push(item);
                    } else {
                        const targets = item._tplLores || [{ name: lore.name }];
                        for (const target of targets) {
                            if (!lorebookGroups.has(target.name)) lorebookGroups.set(target.name, []);
                            lorebookGroups.get(target.name).push(item);
                        }
                    }
                }

                // Save each lorebook group individually; failures are isolated per-lorebook
                const failedItemNames = new Set();
                for (const [lorebookName, groupItems] of lorebookGroups) {
                    try {
                        throwIfStmbStopped(runEpoch);
                        const fresh = await loadWorldInfo(lorebookName);
                        await upsertLorebookEntriesBatch(lorebookName, fresh, groupItems, { refreshEditor });
                        if (lorebookName === lore.name) lore.data = fresh;
                    } catch (saveErr) {
                        if (isStmbStopError(saveErr)) return;
                        console.error(`${MODULE_NAME}: Wave save failed for lorebook "${lorebookName}":`, saveErr);
                        toastr.error(translate('Failed to save SidePrompt updates for this wave', 'STMemoryBooks_Toast_FailedToSaveWave'), 'STMemoryBooks');
                        for (const item of groupItems) {
                            const itemName = item.name || item.title;
                            failedItemNames.add(itemName);
                            results.push({ name: itemName, ok: false, error: saveErr });
                        }
                    }
                }

                // Count successes: skip templates that failed in any lorebook group
                for (const name of succeededNames) {
                    if (failedItemNames.has(name)) continue;
                    results.push({ name, ok: true });
                    if (showNotifications) {
                        toastr.success(__st_t_tag`SidePrompt "${name}" updated.`, 'STMemoryBooks');
                    }
                    console.log(`${MODULE_NAME}: SidePrompt success`, {
                        trigger: 'onAfterMemory',
                        name,
                        saved: true,
                    });
                }
            }
        }
        // Aggregated notifications for AfterMemory side prompts
        if (showNotifications && results.length > 0) {
            const succeeded = results.filter(r => r.ok).map(r => r.name);
            const failed = results.filter(r => !r.ok).map(r => r.name);
            const okCount = succeeded.length;
            const failCount = failed.length;
            const summarize = (arr) => {
                const maxNames = 5;
                if (arr.length === 0) return '';
                const names = arr.slice(0, maxNames).join(', ');
                const more = arr.length > maxNames ? `, +${arr.length - maxNames} more` : '';
                return `${names}${more}`;
            };
            if (failCount === 0) {
                toastr.info(__st_t_tag`Side Prompts after memory: ${okCount} succeeded. ${summarize(succeeded)}`, 'STMemoryBooks');
            } else {
                toastr.warning(__st_t_tag`Side Prompts after memory: ${okCount} succeeded, ${failCount} failed. ${failCount ? 'Failed: ' + summarize(failed) : ''}`, 'STMemoryBooks');
            }
        }
    } catch (outer) {
        if (isStmbStopError(outer)) return;
        console.error(`${MODULE_NAME}: runAfterMemory fatal error:`, outer);
    } finally {
        parentTask.finish();
    }
}



/**
 * Unified manual side prompt runner
 * Usage: /sideprompt "Name" {{macro}}="value" [X-Y]
 */
export async function runSidePrompt(args, options = {}) {
    const debug = !!options.debug;
    _moduleDebug = debug;
    const dbg = _dbg;

    const parentTask = createStmbInFlightTask('SidePrompts:manual');
    const runEpoch = parentTask.epoch;
    const startChatId = _getChatId();
    try {
        dbg('=== Side Prompt Manual Run Start ===');
        dbg('Raw args:', args);
        dbg('Options:', options);
        dbg('Chat ID:', startChatId);

        const lore = await requireLorebookStrict();
        dbg('Lorebook resolved:', { name: lore.name, entryCount: Object.keys(lore.data?.entries || {}).length });

        const parsed = parseSidePromptCommandInput(args);
        dbg('Parsed input:', parsed);
        if (parsed.error || !parsed.name) {
            toastr.error(translate('SidePrompt name not provided. Usage: /sideprompt "Name" {{macro}}="value" [X-Y or last:N]', 'STMemoryBooks_Toast_SidePromptNameNotProvided'), 'STMemoryBooks');
            return '';
        }
        const { name, range, lastN, runtimeMacros } = parsed;

        const tpl = await findTemplateByName(name);
        if (!tpl) {
            dbg('Template not found for name:', name);
            toastr.error(translate('SidePrompt template not found. Check name.', 'STMemoryBooks_Toast_SidePromptNotFound'), 'STMemoryBooks');
            return '';
        }
        dbg('Template found:', { key: tpl.key, name: tpl.name, enabled: tpl.enabled, perCharacter: !!tpl.settings?.perCharacter, triggers: tpl.triggers });

        // Enforce manual gating: only allow /sideprompt if template has the sideprompt command enabled
        const manualEnabled = Array.isArray(tpl?.triggers?.commands) && tpl.triggers.commands.some(c => String(c).toLowerCase() === 'sideprompt');
        if (!manualEnabled) {
            toastr.error(translate('Manual run is disabled for this template. Enable "Allow manual run via /sideprompt" in the template settings.', 'STMemoryBooks_Toast_ManualRunDisabled'), 'STMemoryBooks');
            return '';
        }

        const requiredRuntimeMacros = collectTemplateRuntimeMacros(tpl);
        dbg('Required runtime macros:', requiredRuntimeMacros);
        const missingRuntimeMacros = requiredRuntimeMacros.filter(token => !Object.hasOwn(runtimeMacros, token));
        if (missingRuntimeMacros.length > 0) {
            const usageMacros = requiredRuntimeMacros.map(token => `${token}="value"`).join(' ');
            toastr.error(
                __st_t_tag`SidePrompt "${tpl.name}" requires: ${missingRuntimeMacros.join(', ')}. Usage: /sideprompt "${tpl.name}" ${usageMacros} [X-Y]`,
                'STMemoryBooks',
            );
            return '';
        }

        const tplLores = await resolveLorebooksForTemplate(tpl, lore);
        dbg('Target lorebooks:', tplLores.map(l => l.name));
        const currentLast = chat.length - 1;
        if (currentLast < 0) {
            toastr.error(translate('No messages available.', 'STMemoryBooks_Toast_NoMessagesAvailable'), 'STMemoryBooks');
            return '';
        }

        // Compile window
        let compiled = null;
        if (lastN) {
            // last:N — take the last N messages regardless of checkpoint
            const n = Math.max(1, Math.min(lastN, currentLast + 1));
            const lastNStart = currentLast - n + 1;
            try {
                compiled = await compileRange(lastNStart, currentLast);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange(${lastNStart}, ${currentLast}) failed:`, err);
                toastr.error(translate('Failed to compile messages for /sideprompt', 'STMemoryBooks_Toast_FailedToCompileMessages'), 'STMemoryBooks');
                return '';
            }
        } else if (range) {
            const m = String(range).trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
            if (!m) {
                toastr.error(translate('Invalid range format. Use X-Y', 'STMemoryBooks_Toast_InvalidRangeFormat'), 'STMemoryBooks');
                return '';
            }
            const start = parseInt(m[1], 10);
            const end = parseInt(m[2], 10);
            if (!(start >= 0 && end >= start && end < chat.length)) {
                toastr.error(translate('Invalid message range for /sideprompt', 'STMemoryBooks_Toast_InvalidMessageRange'), 'STMemoryBooks');
                return '';
            }
            try {
                compiled = await compileRange(start, end);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange(${start}, ${end}) failed:`, err);
                toastr.error(translate('Failed to compile the specified range', 'STMemoryBooks_Toast_FailedToCompileRange'), 'STMemoryBooks');
                return '';
            }
        } else {
            // No explicit range — use onInterval.visibleMessages as the window, fallback to 20.
            // This avoids checkpoint bleed on shared lorebooks and keeps manual runs
            // consistent with what the interval trigger would compile.
            const defaultN = Math.max(1, Number(tpl?.triggers?.onInterval?.visibleMessages ?? 20));
            if (!hasShownSidePromptRangeTip) {
                toastr.info(translate('Tip: You can run a specific range with /sideprompt "Name" {{macro}}="value" X-Y (e.g., /sideprompt "Scoreboard" 100-120), or use last:N to take the last N messages (e.g., /sideprompt "Scoreboard" last:30). Running without a range uses the last {{n}} messages (from interval setting).', 'STMemoryBooks_Toast_SidePromptRangeTip').replace('{{n}}', defaultN), 'STMemoryBooks');
                hasShownSidePromptRangeTip = true;
            }
            const autoStart = Math.max(0, currentLast - defaultN + 1);
            console.log(`${MODULE_NAME}: Manual run — no range given, using last ${defaultN} messages (${autoStart}→${currentLast})`);

            try {
                compiled = await compileRange(autoStart, currentLast);
            } catch (err) {
                console.error(`${MODULE_NAME}: compileRange(${autoStart}, ${currentLast}) failed:`, err);
                toastr.error(translate('Failed to compile messages for /sideprompt', 'STMemoryBooks_Toast_FailedToCompileMessages'), 'STMemoryBooks');
                return '';
            }
        }
        const defaultOverrides = resolveSidePromptConnection(null);

        // Per-character mode: resolve lorebooks upfront BEFORE any LLM calls
        const perChar = isPerCharacterTemplate(tpl);
        let charWorkItems; // Array of { charTarget, lore } or [{ charTarget: null, lore: null }]
        if (perChar) {
            const rawChars = discoverChatCharacters();
            dbg('Per-character mode: true, Characters:', rawChars.map(c => ({ name: c.name, lorebook: c.lorebook || '(none)' })));
            if (rawChars.length === 0) {
                toastr.error(translate('No characters found for per-character side prompt.', 'STMemoryBooks_Toast_NoCharactersFound'), 'STMemoryBooks');
                return '';
            }
            charWorkItems = await resolveAllPerCharacterLorebooks(rawChars, tplLores[0]);
            dbg('Characters with resolved lorebooks:', charWorkItems.map(w => ({ name: w.charTarget.name, lorebook: w.lore.name })));
            if (charWorkItems.length === 0) {
                toastr.warning(translate('All characters skipped — no lorebooks selected.', 'STMemoryBooks_Toast_AllCharactersSkipped'), 'STMemoryBooks');
                return '';
            }
        } else {
            charWorkItems = [{ charTarget: null, lore: null }];
            dbg('Per-character mode: false (single run)');
        }

        try {
            for (const { charTarget, lore: charLore } of charWorkItems) {
                const effectiveMacros = charTarget
                    ? buildPerCharacterMacros(charTarget.name, runtimeMacros)
                    : runtimeMacros;
                const displayName = charTarget ? `${tpl.name} (${charTarget.name})` : tpl.name;
                dbg(`--- Processing: ${displayName} ---`);
                dbg('Runtime macros:', effectiveMacros);

                // For per-character: compute title upfront and search character's lorebook for prior
                const perCharTitleHint = charTarget
                    ? getPerCharacterTitle(getUnifiedSidePromptTitle(tpl, effectiveMacros), charTarget.name)
                    : null;

                const prepared = await prepareSidePromptRun({
                    tpl,
                    loreData: (charLore?.data) || tplLores[0].data,
                    compiledScene: compiled,
                    defaultOverrides,
                    fallbackKinds: ['scoreboard', 'plotpoints', 'tracker'],
                    runtimeMacros: effectiveMacros,
                    additionalTitles: perCharTitleHint ? [perCharTitleHint] : [],
                });

                const effectiveTitle = perCharTitleHint || prepared.unifiedTitle;
                dbg('Entry title:', effectiveTitle);
                dbg('Prior entry found:', !!prepared.prior, prepared.prior ? `(${prepared.prior.length} chars)` : '');
                dbg('Connection:', { api: prepared.conn.api, model: prepared.conn.model, temp: prepared.conn.temperature });
                if (debug) {
                    dbg('Full prompt being sent to LLM:\n', prepared.finalPrompt);
                }

                // Call LLM with retry
                let resultText = '';
                console.log(`${MODULE_NAME}: SidePrompt attempt`, {
                    trigger: 'manual',
                    name: tpl.name,
                    key: tpl.key,
                    character: charTarget?.name || null,
                    rangeProvided: !!range,
                    api: prepared.conn.api,
                    model: prepared.conn.model,
                });
                resultText = await runSidePromptWithRetry({
                    taskLabel: `SidePrompt:manual:${tpl?.key || tpl?.name || 'unknown'}${charTarget ? `:${charTarget.name}` : ''}`,
                    finalPrompt: prepared.finalPrompt,
                    conn: prepared.conn,
                    runEpoch,
                    displayName,
                    trigger: 'manual',
                });
                throwIfStmbStopped(runEpoch);
                throwIfChatChanged(startChatId);
                dbg('LLM response received:', resultText.length, 'chars');
                if (debug) {
                    dbg('LLM response content:\n', resultText);
                }
                if (!ensureSidePromptTextNotBlank(resultText, tpl, 'manual')) continue;

                // Preview gating if enabled
                try {
                    throwIfStmbStopped(runEpoch);
                    const previewResult = await resolveSidePromptPreview({
                        tpl,
                        initialText: resultText,
                        finalPrompt: prepared.finalPrompt,
                        conn: prepared.conn,
                        compiledScene: compiled,
                        runEpoch,
                        retryTaskLabel: `SidePrompt:manual:retry:${tpl?.key || tpl?.name || 'unknown'}${charTarget ? `:${charTarget.name}` : ''}`,
                    });
                    if (!previewResult.approved) {
                        toastr.info(__st_t_tag`SidePrompt "${displayName}" canceled.`, 'STMemoryBooks');
                        continue;
                    }
                    resultText = previewResult.text;
                } catch (previewErr) {
                    console.warn(`${MODULE_NAME}: Preview step failed; proceeding without preview`, previewErr);
                }
                throwIfStmbStopped(runEpoch);
                throwIfChatChanged(startChatId);
                if (!ensureSidePromptTextNotBlank(resultText, tpl, 'manual')) continue;
                const lbs = getEffectiveLorebookSettingsForTemplate(tpl);
                const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lbs, effectiveMacros);
                // Add character name to keywords for per-character entries
                if (charTarget) {
                    if (entryOverrides.key) {
                        if (!entryOverrides.key.some(k => k.toLowerCase() === charTarget.name.toLowerCase())) {
                            entryOverrides.key.push(charTarget.name);
                        }
                    } else {
                        entryOverrides.key = [charTarget.name];
                    }
                }
                const endId = compiled?.metadata?.sceneEnd ?? currentLast;
                const checkpointSuffix = charTarget ? `_${charTarget.name}` : '';
                const metadataUpdates = {
                    [`STMB_sp_${tpl.key}${checkpointSuffix}_lastMsgId`]: endId,
                    [`STMB_sp_${tpl.key}${checkpointSuffix}_lastRunAt`]: new Date().toISOString(),
                    STMB_tracker_lastMsgId: endId,
                    STMB_tracker_lastRunAt: new Date().toISOString(),
                };
                if (charTarget) {
                    metadataUpdates.STMB_character = charTarget.name;
                }
                dbg('Upsert params:', { title: effectiveTitle, defaults, entryOverrides, metadataUpdates });
                const refreshEditor = extension_settings?.STMemoryBooks?.moduleSettings?.refreshEditor !== false;

                // Per-character: use pre-resolved lorebook; standard: use template lorebooks
                if (charTarget && charLore) {
                    dbg(`Writing to lorebook: "${charLore.name}", title: "${effectiveTitle}", content: ${resultText.length} chars`);
                    // Reload fresh data in case another character's upsert modified it
                    const freshData = await loadWorldInfo(charLore.name).catch(() => charLore.data);
                    await upsertLorebookEntryByTitle(charLore.name, freshData || charLore.data, effectiveTitle, resultText, {
                        defaults,
                        entryOverrides,
                        metadataUpdates,
                        refreshEditor,
                    });
                    dbg(`Upsert complete for lorebook: "${charLore.name}"`);
                } else {
                    for (const tplLore of tplLores) {
                        const targetData = tplLore.name === tplLores[0].name
                            ? tplLore.data
                            : (await loadWorldInfo(tplLore.name).catch(() => null));
                        if (!targetData) {
                            console.warn(`${MODULE_NAME}: Could not reload lorebook "${tplLore.name}" for write; skipping.`);
                            continue;
                        }
                        dbg(`Writing to lorebook: "${tplLore.name}", title: "${effectiveTitle}", content: ${resultText.length} chars`);
                        await upsertLorebookEntryByTitle(tplLore.name, targetData, effectiveTitle, resultText, {
                            defaults,
                            entryOverrides,
                            metadataUpdates,
                            refreshEditor,
                        });
                        dbg(`Upsert complete for lorebook: "${tplLore.name}"`);
                    }
                }
                console.log(`${MODULE_NAME}: SidePrompt success`, {
                    trigger: 'manual',
                    name: tpl.name,
                    key: tpl.key,
                    character: charTarget?.name || null,
                    saved: true,
                    contentChars: resultText.length,
                });
                dbg(`Done: "${displayName}" saved successfully`);
                toastr.success(__st_t_tag`SidePrompt "${displayName}" updated.`, 'STMemoryBooks');
            }
            dbg('=== Side Prompt Manual Run Complete ===');
        } catch (err) {
            if (isSidePromptAbortError(err)) return '';
            console.error(`${MODULE_NAME}: /sideprompt failed:`, err);
            if (debug) dbg('Error:', err);
            toastr.error(__st_t_tag`SidePrompt "${tpl.name}" failed: ${err.message}`, 'STMemoryBooks');
            return '';
        }
        return '';
    } catch (outer) {
        if (isSidePromptAbortError(outer)) return '';
        console.error(`${MODULE_NAME}: runSidePrompt fatal error:`, outer);
        return '';
    } finally {
        _moduleDebug = false;
        parentTask.finish();
    }
}
