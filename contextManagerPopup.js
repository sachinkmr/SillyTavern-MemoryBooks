/**
 * Context Manager UI — Popup for managing Context Manager templates
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { world_names } from '../../../world-info.js';
import {
    listTemplates,
    getTemplate,
    upsertTemplate,
    duplicateTemplate,
    removeTemplate,
    discoverCharacterLorebooks,
} from './contextManager.js';
import { contextManagerTableTemplate } from './templatesContextManager.js';
import { translate } from '../../../i18n.js';
import { getSceneMarkers, saveMetadataForCurrentContext } from './sceneManager.js';

function getTriggersSummary(tpl) {
    const badges = [];
    const trig = tpl?.triggers || {};
    if (trig.onInterval && Number(trig.onInterval.visibleMessages) >= 1) {
        badges.push(`Interval:${Number(trig.onInterval.visibleMessages)}`);
    }
    if (trig.onAfterMemory && !!trig.onAfterMemory.enabled) {
        badges.push('AfterMemory');
    }
    if (Array.isArray(trig.commands) && trig.commands.some(c => String(c).toLowerCase() === 'contextmanager')) {
        badges.push('Manual');
    }
    return badges;
}

function renderTemplatesTable(templates) {
    const stmbData = getSceneMarkers() || {};
    const chatDisabled = Array.isArray(stmbData.disabledContextManager) ? stmbData.disabledContextManager : [];

    const items = (templates || []).map(t => {
        const hasAutoTrigger = (t.triggers?.onInterval && Number(t.triggers.onInterval.visibleMessages) >= 1)
            || !!t.triggers?.onAfterMemory?.enabled;
        return {
            key: String(t.key || ''),
            name: String(t.name || ''),
            enabled: !!t.enabled,
            hasAutoTrigger,
            chatEnabled: !chatDisabled.includes(t.key),
            badges: getTriggersSummary(t),
        };
    });
    return contextManagerTableTemplate({ items });
}

function refreshList(popup, preserveKey = null) {
    const listContainer = popup?.dlg?.querySelector('#stmb-cm-list');
    if (!listContainer) return;

    const searchTerm = (popup?.dlg?.querySelector('#stmb-cm-search')?.value || '').toLowerCase();
    const templates = listTemplates();
    const filtered = searchTerm
        ? templates.filter(t => {
            const nameMatch = t.name.toLowerCase().includes(searchTerm);
            const trigStr = getTriggersSummary(t).join(' ').toLowerCase();
            return nameMatch || trigStr.includes(searchTerm);
        })
        : templates;

    listContainer.innerHTML = DOMPurify.sanitize(renderTemplatesTable(filtered));

    if (preserveKey) {
        const row = listContainer.querySelector(`tr[data-tpl-key="${CSS.escape(preserveKey)}"]`);
        if (row) {
            row.style.backgroundColor = 'var(--cobalt30a)';
        }
    }
}

// ─── Edit Template Popup ───────────────────────────────────────────────

async function openEditTemplate(parentPopup, key) {
    try {
        const tpl = getTemplate(key);
        if (!tpl) {
            toastr.error('Template not found', 'STMemoryBooks');
            return;
        }

        const currentEnabled = !!tpl.enabled;
        const s = tpl.settings || {};
        const trig = tpl.triggers || {};

        const hasAutoTrigger = (trig.onInterval && Number(trig.onInterval?.visibleMessages) >= 1) || !!trig.onAfterMemory?.enabled;
        const chatDisabled = (getSceneMarkers()?.disabledContextManager ?? []);
        const chatEnabled = !chatDisabled.includes(tpl.key);

        const intervalEnabled = !!(trig.onInterval && Number(trig.onInterval.visibleMessages) >= 1);
        const intervalVal = intervalEnabled ? Math.max(1, Number(trig.onInterval.visibleMessages)) : 50;
        const afterEnabled = !!(trig.onAfterMemory && trig.onAfterMemory.enabled);
        const manualEnabled = Array.isArray(trig.commands)
            ? trig.commands.some(c => String(c).toLowerCase() === 'contextmanager')
            : true;

        // Profile override
        const profiles = extension_settings?.STMemoryBooks?.profiles || [];
        let idx = Number.isFinite(s.overrideProfileIndex) ? Number(s.overrideProfileIndex) : (extension_settings?.STMemoryBooks?.defaultProfile ?? 0);
        if (!(idx >= 0 && idx < profiles.length)) idx = 0;
        const overrideEnabled = !!s.overrideProfileEnabled;
        const profileOptions = profiles.map((p, i) =>
            `<option value="${i}" ${i === idx ? 'selected' : ''}>${escapeHtml(p?.name || ('Profile ' + (i + 1)))}</option>`
        ).join('');

        // Lorebook entry settings
        const prevMemCount = Number.isFinite(s.previousMemoriesCount) ? Number(s.previousMemoriesCount) : 3;
        const lastNMessages = Number.isFinite(s.lastNMessages) ? Number(s.lastNMessages) : 50;
        const lb = (s && s.lorebook) || {};
        const lbMode = lb.constVectMode || 'blue';
        const lbPosition = Number.isFinite(lb.position) ? Number(lb.position) : 2;
        const lbOrderManual = lb.orderMode === 'manual';
        const lbOrderValue = Number.isFinite(lb.orderValue) ? Number(lb.orderValue) : 25;
        const lbPrevent = lb.preventRecursion !== false;
        const lbDelay = !!lb.delayUntilRecursion;
        const lbIgnoreBudget = !!lb.ignoreBudget;
        const lbEntryTitleOverride = String(lb.entryTitleOverride || '');
        const lbEntryKeywords = String(lb.entryKeywords || '');

        // Discovered character lorebooks info
        const charLorebooks = discoverCharacterLorebooks();
        const charInfoHtml = charLorebooks.length > 0
            ? charLorebooks.map(c =>
                `<span class="badge" style="margin-right:6px;">${escapeHtml(c.characterName)}${c.lorebookName ? ` → ${escapeHtml(c.lorebookName)}` : ' ⚠️ no lorebook'}</span>`
            ).join('')
            : '<span class="opacity50p">No characters discovered</span>';

        const content = `
            <h3>Edit Context Manager Template</h3>
            <div class="world_entry_form_control">
                <small>Key: <code>${escapeHtml(tpl.key)}</code></small>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-cm-edit-name">
                    <h4>Name:</h4>
                    <input type="text" id="stmb-cm-edit-name" class="text_pole" value="${escapeHtml(tpl.name)}" />
                </label>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-edit-enabled" ${currentEnabled ? 'checked' : ''}>
                    <span>Enabled</span>
                </label>
            </div>
            ${hasAutoTrigger ? `<div class="world_entry_form_control">
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-edit-chat-enabled" ${chatEnabled ? 'checked' : ''} ${!currentEnabled ? 'disabled' : ''}>
                    <span>Enabled in this chat</span>
                </label>
                <small class="opacity50p">Disabling only affects auto-triggers for the current chat. Manual /contextmanager runs are unaffected.</small>
            </div>` : ''}

            <div class="world_entry_form_control">
                <h4>Detected Characters & Lorebooks:</h4>
                <div style="padding: 4px 0;">${charInfoHtml}</div>
                <small class="opacity70p">Context Manager auto-discovers character lorebooks. Each character gets a separate LLM call with {{char}} resolved to their name.</small>
            </div>

            <div class="world_entry_form_control">
                <h4>Triggers:</h4>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-edit-trg-interval" ${intervalEnabled ? 'checked' : ''}>
                    <span>Run on visible message interval</span>
                </label>
                <div id="stmb-cm-edit-interval-container" style="display:${intervalEnabled ? 'block' : 'none'}; margin-left:28px;">
                    <label for="stmb-cm-edit-interval">
                        <h4 style="margin: 0 0 4px 0;">Interval (visible messages):</h4>
                        <input type="number" id="stmb-cm-edit-interval" class="text_pole" min="1" step="1" value="${intervalVal}">
                    </label>
                </div>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-edit-trg-aftermem" ${afterEnabled ? 'checked' : ''}>
                    <span>Run automatically after memory</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-edit-trg-manual" ${manualEnabled ? 'checked' : ''}>
                    <span>Allow manual run via /contextmanager</span>
                </label>
            </div>

            <div class="world_entry_form_control">
                <label for="stmb-cm-edit-last-n">
                    <h5>Last N messages to compile:</h5>
                    <input type="number" id="stmb-cm-edit-last-n" class="text_pole" min="1" step="1" value="${lastNMessages}">
                </label>
                <small class="opacity70p">Number of recent messages to include as scene text for the LLM.</small>
            </div>

            <div class="world_entry_form_control">
                <label for="stmb-cm-edit-prev-mem-count">
                    <h5>Previous memories for context:</h5>
                    <input type="number" id="stmb-cm-edit-prev-mem-count" class="text_pole" min="0" max="7" step="1" value="${prevMemCount}">
                </label>
                <small class="opacity70p">Number of previous memory entries to include before scene text (0 = none).</small>
            </div>

            <div class="world_entry_form_control">
                <label for="stmb-cm-edit-prompt">
                    <h4>Prompt:</h4>
                    <textarea id="stmb-cm-edit-prompt" class="text_pole textarea_compact" rows="10">${escapeHtml(tpl.prompt || '')}</textarea>
                </label>
                <small class="opacity70p">Use {{char}} for the character name and {{user}} for the user name. Each character gets a separate call.</small>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-cm-edit-response-format">
                    <h4>Response Format (optional):</h4>
                    <textarea id="stmb-cm-edit-response-format" class="text_pole textarea_compact" rows="6">${escapeHtml(tpl.responseFormat || '')}</textarea>
                </label>
            </div>

            <div class="world_entry_form_control">
                <h4>Lorebook Entry Settings</h4>
                <label for="stmb-cm-edit-lb-entry-title-override">
                    <h5 style="margin: 8px 0 4px 0;">Entry Title Override</h5>
                    <small class="opacity70p">Optional. Default: "{{char}} TemplateName (STMB CM)". Standard ST macros are resolved.</small>
                    <input type="text" id="stmb-cm-edit-lb-entry-title-override" class="text_pole" value="${escapeHtml(lbEntryTitleOverride)}" placeholder="Optional title template">
                </label>
                <label for="stmb-cm-edit-lb-entry-keywords">
                    <h5 style="margin: 8px 0 4px 0;">Entry Keywords</h5>
                    <small class="opacity70p">Optional comma-separated keywords applied to the lorebook entry.</small>
                    <input type="text" id="stmb-cm-edit-lb-entry-keywords" class="text_pole" value="${escapeHtml(lbEntryKeywords)}" placeholder="Optional comma-separated keywords">
                </label>
            </div>

            <div class="world_entry_form_control">
                <div class="flex-container" style="gap:12px; flex-wrap: wrap;">
                    <label>
                        <h5 style="margin: 0 0 4px 0;">Activation Mode</h5>
                        <select id="stmb-cm-edit-lb-mode" class="text_pole">
                            <option value="link" ${lbMode === 'link' ? 'selected' : ''}>🔗 Vectorized</option>
                            <option value="green" ${lbMode === 'green' ? 'selected' : ''}>🟢 Normal</option>
                            <option value="blue" ${lbMode === 'blue' ? 'selected' : ''}>🔵 Constant</option>
                        </select>
                    </label>
                </div>
            </div>
            <div class="world_entry_form_control">
                <div class="flex-container" style="gap:12px; flex-wrap: wrap;">
                    <label>
                        <h5 style="margin: 12px 0 4px 0;">Insertion Position:</h5>
                        <select id="stmb-cm-edit-lb-position" class="text_pole">
                            <option value="0" ${lbPosition === 0 ? 'selected' : ''}>↑Char</option>
                            <option value="1" ${lbPosition === 1 ? 'selected' : ''}>↓Char</option>
                            <option value="5" ${lbPosition === 5 ? 'selected' : ''}>↑EM</option>
                            <option value="6" ${lbPosition === 6 ? 'selected' : ''}>↓EM</option>
                            <option value="2" ${lbPosition === 2 ? 'selected' : ''}>↑AN</option>
                            <option value="3" ${lbPosition === 3 ? 'selected' : ''}>↓AN</option>
                            <option value="7" ${lbPosition === 7 ? 'selected' : ''}>Outlet</option>
                        </select>
                        <div id="stmb-cm-edit-lb-outlet-name-container" style="display:${lbPosition === 7 ? 'block' : 'none'}; margin-top: 8px;">
                            <label>
                                <h5 style="margin: 0 0 4px 0;">Outlet Name:</h5>
                                <input type="text" id="stmb-cm-edit-lb-outlet-name" class="text_pole" placeholder="Outlet name" value="${escapeHtml(lb.outletName || '')}">
                            </label>
                        </div>
                    </label>
                </div>
                <div class="world_entry_form_control" style="margin-top: 8px;">
                    <h5>Insertion Order:</h5>
                    <label class="radio_label">
                        <input type="radio" name="stmb-cm-edit-lb-order-mode" id="stmb-cm-edit-lb-order-auto" value="auto" ${lbOrderManual ? '' : 'checked'}>
                        <span>Auto</span>
                    </label>
                    <label class="radio_label">
                        <input type="radio" name="stmb-cm-edit-lb-order-mode" id="stmb-cm-edit-lb-order-manual" value="manual" ${lbOrderManual ? 'checked' : ''}>
                        <span>Manual</span>
                    </label>
                </div>
                <div class="world_entry_form_control" style="margin-top: 8px;">
                    <div id="stmb-cm-edit-lb-order-value-container" style="display:${lbOrderManual ? 'block' : 'none'}; margin-top: 8px;">
                        <label>
                            <h5>Order Value:</h5>
                            <input type="number" id="stmb-cm-edit-lb-order-value" class="text_pole" step="1" value="${lbOrderValue}">
                        </label>
                    </div>
                </div>
                <div class="world_entry_form_control" style="margin-top: 8px;">
                    <label class="checkbox_label">
                        <input type="checkbox" id="stmb-cm-edit-lb-prevent" ${lbPrevent ? 'checked' : ''}>
                        <span>Prevent Recursion</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="stmb-cm-edit-lb-delay" ${lbDelay ? 'checked' : ''}>
                        <span>Delay Until Recursion</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="stmb-cm-edit-lb-ignore-budget" ${lbIgnoreBudget ? 'checked' : ''}>
                        <span>Ignore Budget</span>
                    </label>
                </div>
            </div>

            <div class="world_entry_form_control">
                <h5>Overrides:</h5>
                <div class="world_entry_form_control">
                    <label class="checkbox_label">
                        <input type="checkbox" id="stmb-cm-edit-override-enabled" ${overrideEnabled ? 'checked' : ''}>
                        <span>Override default memory profile</span>
                    </label>
                </div>
                <div class="world_entry_form_control" id="stmb-cm-edit-override-container" style="display: ${overrideEnabled ? 'block' : 'none'};">
                    <label for="stmb-cm-edit-override-index">
                        <h4>Connection Profile:</h4>
                        <select id="stmb-cm-edit-override-index" class="text_pole">
                            ${profileOptions}
                        </select>
                    </label>
                </div>
            </div>
        `;

        const editPopup = new Popup(DOMPurify.sanitize(content), POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: 'Save',
            cancelButton: 'Cancel',
        });

        const attachHandlers = () => {
            const dlg = editPopup.dlg;
            if (!dlg) return;

            // Chat toggle
            const cbEnabled = dlg.querySelector('#stmb-cm-edit-enabled');
            const cbChatEnabled = dlg.querySelector('#stmb-cm-edit-chat-enabled');
            if (cbChatEnabled) {
                cbChatEnabled.addEventListener('change', () => {
                    const stmbData = getSceneMarkers() || {};
                    const disabled = Array.isArray(stmbData.disabledContextManager) ? [...stmbData.disabledContextManager] : [];
                    if (cbChatEnabled.checked) {
                        const idx = disabled.indexOf(key);
                        if (idx !== -1) disabled.splice(idx, 1);
                    } else {
                        if (!disabled.includes(key)) disabled.push(key);
                    }
                    stmbData.disabledContextManager = disabled;
                    saveMetadataForCurrentContext();
                });
                cbEnabled?.addEventListener('change', () => {
                    cbChatEnabled.disabled = !cbEnabled.checked;
                });
            }

            // Interval toggle
            const cbInterval = dlg.querySelector('#stmb-cm-edit-trg-interval');
            const intervalCont = dlg.querySelector('#stmb-cm-edit-interval-container');
            cbInterval?.addEventListener('change', () => {
                if (intervalCont) intervalCont.style.display = cbInterval.checked ? 'block' : 'none';
            });

            // Profile override toggle
            const cbOverride = dlg.querySelector('#stmb-cm-edit-override-enabled');
            const overrideCont = dlg.querySelector('#stmb-cm-edit-override-container');
            cbOverride?.addEventListener('change', () => {
                if (overrideCont) overrideCont.style.display = cbOverride.checked ? 'block' : 'none';
            });

            // Order mode
            const orderAuto = dlg.querySelector('#stmb-cm-edit-lb-order-auto');
            const orderManual = dlg.querySelector('#stmb-cm-edit-lb-order-manual');
            const orderValCont = dlg.querySelector('#stmb-cm-edit-lb-order-value-container');
            const syncOrderVisibility = () => {
                if (orderValCont) orderValCont.style.display = orderManual?.checked ? 'block' : 'none';
            };
            orderAuto?.addEventListener('change', syncOrderVisibility);
            orderManual?.addEventListener('change', syncOrderVisibility);

            // Outlet name
            const posSel = dlg.querySelector('#stmb-cm-edit-lb-position');
            const outletCont = dlg.querySelector('#stmb-cm-edit-lb-outlet-name-container');
            posSel?.addEventListener('change', () => {
                if (outletCont) outletCont.style.display = posSel.value === '7' ? 'block' : 'none';
            });
        };

        const showPromise = editPopup.show();
        attachHandlers();
        const result = await showPromise;

        if (result === POPUP_RESULT.AFFIRMATIVE) {
            const dlg = editPopup.dlg;
            const newName = dlg.querySelector('#stmb-cm-edit-name')?.value.trim() || '';
            const newPrompt = dlg.querySelector('#stmb-cm-edit-prompt')?.value.trim() || '';
            const newResponseFormat = dlg.querySelector('#stmb-cm-edit-response-format')?.value.trim() || '';
            const newEnabled = !!dlg.querySelector('#stmb-cm-edit-enabled')?.checked;

            if (!newPrompt) {
                toastr.error('Prompt cannot be empty', 'STMemoryBooks');
                return;
            }

            // Triggers
            const triggers = {};
            const intervalOn = !!dlg.querySelector('#stmb-cm-edit-trg-interval')?.checked;
            const afterOn = !!dlg.querySelector('#stmb-cm-edit-trg-aftermem')?.checked;
            const manualOn = !!dlg.querySelector('#stmb-cm-edit-trg-manual')?.checked;

            if (intervalOn) {
                const intervalRaw = parseInt(dlg.querySelector('#stmb-cm-edit-interval')?.value ?? '50', 10);
                triggers.onInterval = { visibleMessages: Math.max(1, isNaN(intervalRaw) ? 50 : intervalRaw) };
            }
            if (afterOn) {
                triggers.onAfterMemory = { enabled: true };
            }
            if (manualOn) {
                triggers.commands = ['contextmanager'];
            }

            // Settings
            const settings = { ...(tpl.settings || {}) };
            const overrideEnabled2 = !!dlg.querySelector('#stmb-cm-edit-override-enabled')?.checked;
            settings.overrideProfileEnabled = overrideEnabled2;
            if (overrideEnabled2) {
                const oidx = parseInt(dlg.querySelector('#stmb-cm-edit-override-index')?.value ?? '', 10);
                if (!isNaN(oidx)) settings.overrideProfileIndex = oidx;
            } else {
                delete settings.overrideProfileIndex;
            }

            const lastNRaw = parseInt(dlg.querySelector('#stmb-cm-edit-last-n')?.value ?? '50', 10);
            settings.lastNMessages = Number.isFinite(lastNRaw) && lastNRaw > 0 ? lastNRaw : 50;

            const prevCountRaw = parseInt(dlg.querySelector('#stmb-cm-edit-prev-mem-count')?.value ?? '3', 10);
            settings.previousMemoriesCount = Number.isFinite(prevCountRaw) && prevCountRaw > 0 ? Math.min(prevCountRaw, 7) : 0;

            const lorebookEntryTitleOverride = dlg.querySelector('#stmb-cm-edit-lb-entry-title-override')?.value.trim() || '';
            const lorebookEntryKeywords = dlg.querySelector('#stmb-cm-edit-lb-entry-keywords')?.value.trim() || '';

            const lbModeSel = dlg.querySelector('#stmb-cm-edit-lb-mode')?.value || 'blue';
            const lbPosRaw = parseInt(dlg.querySelector('#stmb-cm-edit-lb-position')?.value ?? '2', 10);
            const lbOrderManual2 = !!dlg.querySelector('#stmb-cm-edit-lb-order-manual')?.checked;
            const lbOrderValRaw = parseInt(dlg.querySelector('#stmb-cm-edit-lb-order-value')?.value ?? '25', 10);
            const lbPrevent2 = !!dlg.querySelector('#stmb-cm-edit-lb-prevent')?.checked;
            const lbDelay2 = !!dlg.querySelector('#stmb-cm-edit-lb-delay')?.checked;
            const lbIgnoreBudget2 = !!dlg.querySelector('#stmb-cm-edit-lb-ignore-budget')?.checked;
            const outletNameVal = lbPosRaw === 7 ? (dlg.querySelector('#stmb-cm-edit-lb-outlet-name')?.value?.trim() || '') : '';

            settings.lorebook = {
                constVectMode: ['link', 'green', 'blue'].includes(lbModeSel) ? lbModeSel : 'blue',
                position: Number.isFinite(lbPosRaw) ? lbPosRaw : 2,
                orderMode: lbOrderManual2 ? 'manual' : 'auto',
                orderValue: Number.isFinite(lbOrderValRaw) ? lbOrderValRaw : 25,
                preventRecursion: lbPrevent2,
                delayUntilRecursion: lbDelay2,
                ignoreBudget: lbIgnoreBudget2,
                ...(lbPosRaw === 7 && outletNameVal ? { outletName: outletNameVal } : {}),
                ...(lorebookEntryTitleOverride ? { entryTitleOverride: lorebookEntryTitleOverride } : {}),
                ...(lorebookEntryKeywords ? { entryKeywords: lorebookEntryKeywords } : {}),
            };

            upsertTemplate({
                key: tpl.key,
                name: newName || tpl.name,
                enabled: newEnabled,
                prompt: newPrompt,
                responseFormat: newResponseFormat,
                settings,
                triggers,
            });
            toastr.success(`Context Manager "${newName || tpl.name}" updated.`, 'STMemoryBooks');
            refreshList(parentPopup, tpl.key);
        }
    } catch (err) {
        console.error('STMemoryBooks: Error editing context manager template:', err);
        toastr.error('Failed to edit template', 'STMemoryBooks');
    }
}

// ─── New Template Popup ────────────────────────────────────────────────

async function openNewTemplate(parentPopup) {
    const profiles = extension_settings?.STMemoryBooks?.profiles || [];
    let idx = Number(extension_settings?.STMemoryBooks?.defaultProfile ?? 0);
    if (!(idx >= 0 && idx < profiles.length)) idx = 0;
    const profileOptions = profiles.map((p, i) =>
        `<option value="${i}" ${i === idx ? 'selected' : ''}>${escapeHtml(p?.name || ('Profile ' + (i + 1)))}</option>`
    ).join('');

    const content = `
        <h3>New Context Manager Template</h3>
        <div class="world_entry_form_control">
            <label for="stmb-cm-new-name">
                <h4>Name:</h4>
                <input type="text" id="stmb-cm-new-name" class="text_pole" placeholder="Template name" />
            </label>
        </div>
        <div class="world_entry_form_control">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-cm-new-enabled" checked>
                <span>Enabled</span>
            </label>
        </div>
        <div class="world_entry_form_control">
            <h4>Triggers:</h4>
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-cm-new-trg-interval">
                <span>Run on visible message interval</span>
            </label>
            <div id="stmb-cm-new-interval-container" style="display:none; margin-left:28px;">
                <label for="stmb-cm-new-interval">
                    <h4 style="margin: 0 0 4px 0;">Interval (visible messages):</h4>
                    <input type="number" id="stmb-cm-new-interval" class="text_pole" min="1" step="1" value="50">
                </label>
            </div>
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-cm-new-trg-aftermem">
                <span>Run automatically after memory</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-cm-new-trg-manual" checked>
                <span>Allow manual run via /contextmanager</span>
            </label>
        </div>

        <div class="world_entry_form_control">
            <label for="stmb-cm-new-last-n">
                <h5>Last N messages to compile:</h5>
                <input type="number" id="stmb-cm-new-last-n" class="text_pole" min="1" step="1" value="50">
            </label>
        </div>

        <div class="world_entry_form_control">
            <label for="stmb-cm-new-prev-mem-count">
                <h5>Previous memories for context:</h5>
                <input type="number" id="stmb-cm-new-prev-mem-count" class="text_pole" min="0" max="7" step="1" value="3">
            </label>
        </div>

        <div class="world_entry_form_control">
            <label for="stmb-cm-new-prompt">
                <h4>Prompt:</h4>
                <textarea id="stmb-cm-new-prompt" class="text_pole textarea_compact" rows="10" placeholder="Track what {{char}} knows, remembers, and has experienced..."></textarea>
            </label>
        </div>
        <div class="world_entry_form_control">
            <label for="stmb-cm-new-response-format">
                <h4>Response Format (optional):</h4>
                <textarea id="stmb-cm-new-response-format" class="text_pole textarea_compact" rows="6" placeholder="=== {{char}}'s Context ===\n..."></textarea>
            </label>
        </div>

        <div class="world_entry_form_control">
            <h4>Lorebook Entry Settings</h4>
            <div class="flex-container" style="gap:12px; flex-wrap: wrap;">
                <label>
                    <h5>Activation Mode</h5>
                    <select id="stmb-cm-new-lb-mode" class="text_pole">
                        <option value="link">🔗 Vectorized</option>
                        <option value="green">🟢 Normal</option>
                        <option value="blue" selected>🔵 Constant</option>
                    </select>
                </label>
                <label>
                    <h5>Insertion Position:</h5>
                    <select id="stmb-cm-new-lb-position" class="text_pole">
                        <option value="0">↑Char</option>
                        <option value="1">↓Char</option>
                        <option value="5">↑EM</option>
                        <option value="6">↓EM</option>
                        <option value="2" selected>↑AN</option>
                        <option value="3">↓AN</option>
                        <option value="7">Outlet</option>
                    </select>
                </label>
            </div>
        </div>

        <div class="world_entry_form_control">
            <h5>Overrides:</h5>
            <div class="world_entry_form_control">
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-cm-new-override-enabled">
                    <span>Override default memory profile</span>
                </label>
            </div>
            <div class="world_entry_form_control" id="stmb-cm-new-override-container" style="display: none;">
                <label for="stmb-cm-new-override-index">
                    <h4>Connection Profile:</h4>
                    <select id="stmb-cm-new-override-index" class="text_pole">
                        ${profileOptions}
                    </select>
                </label>
            </div>
        </div>
    `;

    const newPopup = new Popup(DOMPurify.sanitize(content), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: 'Create',
        cancelButton: 'Cancel',
    });

    const attachHandlers = () => {
        const dlg = newPopup.dlg;
        if (!dlg) return;

        const cbInterval = dlg.querySelector('#stmb-cm-new-trg-interval');
        const intervalCont = dlg.querySelector('#stmb-cm-new-interval-container');
        cbInterval?.addEventListener('change', () => {
            if (intervalCont) intervalCont.style.display = cbInterval.checked ? 'block' : 'none';
        });

        const cbOverride = dlg.querySelector('#stmb-cm-new-override-enabled');
        const overrideCont = dlg.querySelector('#stmb-cm-new-override-container');
        cbOverride?.addEventListener('change', () => {
            if (overrideCont) overrideCont.style.display = cbOverride.checked ? 'block' : 'none';
        });
    };

    const showPromise = newPopup.show();
    attachHandlers();
    const result = await showPromise;

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const dlg = newPopup.dlg;
        const newName = dlg.querySelector('#stmb-cm-new-name')?.value.trim() || '';
        const newPrompt = dlg.querySelector('#stmb-cm-new-prompt')?.value.trim() || '';
        const newResponseFormat = dlg.querySelector('#stmb-cm-new-response-format')?.value.trim() || '';
        const newEnabled = !!dlg.querySelector('#stmb-cm-new-enabled')?.checked;

        if (!newPrompt) {
            toastr.error('Prompt cannot be empty', 'STMemoryBooks');
            return;
        }
        if (!newName) {
            toastr.error('Name cannot be empty', 'STMemoryBooks');
            return;
        }

        const triggers = {};
        if (!!dlg.querySelector('#stmb-cm-new-trg-interval')?.checked) {
            const intervalRaw = parseInt(dlg.querySelector('#stmb-cm-new-interval')?.value ?? '50', 10);
            triggers.onInterval = { visibleMessages: Math.max(1, isNaN(intervalRaw) ? 50 : intervalRaw) };
        }
        if (!!dlg.querySelector('#stmb-cm-new-trg-aftermem')?.checked) {
            triggers.onAfterMemory = { enabled: true };
        }
        if (!!dlg.querySelector('#stmb-cm-new-trg-manual')?.checked) {
            triggers.commands = ['contextmanager'];
        }

        const settings = {};
        const overrideEnabledNew = !!dlg.querySelector('#stmb-cm-new-override-enabled')?.checked;
        settings.overrideProfileEnabled = overrideEnabledNew;
        if (overrideEnabledNew) {
            const oidx = parseInt(dlg.querySelector('#stmb-cm-new-override-index')?.value ?? '', 10);
            if (!isNaN(oidx)) settings.overrideProfileIndex = oidx;
        }

        const lastNRaw = parseInt(dlg.querySelector('#stmb-cm-new-last-n')?.value ?? '50', 10);
        settings.lastNMessages = Number.isFinite(lastNRaw) && lastNRaw > 0 ? lastNRaw : 50;

        const prevCountRaw = parseInt(dlg.querySelector('#stmb-cm-new-prev-mem-count')?.value ?? '3', 10);
        settings.previousMemoriesCount = Number.isFinite(prevCountRaw) && prevCountRaw > 0 ? Math.min(prevCountRaw, 7) : 0;

        const lbModeSel = dlg.querySelector('#stmb-cm-new-lb-mode')?.value || 'blue';
        const lbPosRaw = parseInt(dlg.querySelector('#stmb-cm-new-lb-position')?.value ?? '2', 10);

        settings.lorebook = {
            constVectMode: ['link', 'green', 'blue'].includes(lbModeSel) ? lbModeSel : 'blue',
            position: Number.isFinite(lbPosRaw) ? lbPosRaw : 2,
            orderMode: 'manual',
            orderValue: 25,
            preventRecursion: true,
            delayUntilRecursion: false,
            ignoreBudget: false,
        };

        const created = upsertTemplate({
            name: newName,
            enabled: newEnabled,
            prompt: newPrompt,
            responseFormat: newResponseFormat,
            settings,
            triggers,
        });
        toastr.success(`Context Manager "${newName}" created.`, 'STMemoryBooks');
        refreshList(parentPopup, created?.key);
    }
}

// ─── Main Popup ────────────────────────────────────────────────────────

export async function showContextManagerPopup() {
    try {
        let content = '<h3>🧠 Context Manager</h3>';
        content += '<small class="opacity70p">Per-character lorebook writer. Auto-discovers character lorebooks and makes separate LLM calls per character.</small>';

        // Search
        content += '<div class="world_entry_form_control">';
        content += '<input type="text" id="stmb-cm-search" class="text_pole" placeholder="Search templates..." aria-label="Search templates" />';
        content += '</div>';

        // List container
        content += '<div id="stmb-cm-list" class="padding10 marginBot10" style="max-height: 400px; overflow-y: auto;"></div>';

        // Buttons
        content += '<div class="buttons_block justifyCenter gap10px whitespacenowrap">';
        content += '<button id="stmb-cm-new" class="menu_button whitespacenowrap">New Template</button>';
        content += '</div>';

        const popup = new Popup(DOMPurify.sanitize(content), POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: false,
            cancelButton: 'Close',
        });

        const attachHandlers = () => {
            const dlg = popup.dlg;
            if (!dlg) return;

            // Search
            dlg.querySelector('#stmb-cm-search')?.addEventListener('input', () => refreshList(popup));

            // New button
            dlg.querySelector('#stmb-cm-new')?.addEventListener('click', async () => {
                await openNewTemplate(popup);
            });

            // Global enable/disable toggle (delegated)
            dlg.addEventListener('change', (e) => {
                const toggle = e.target.closest('.stmb-cm-toggle-enabled');
                if (!toggle) return;
                e.stopPropagation();
                const key = toggle.dataset.key;
                if (!key) return;
                upsertTemplate({ key, enabled: toggle.checked });
                refreshList(popup, key);
            });

            // Per-chat toggle (delegated)
            dlg.addEventListener('change', (e) => {
                const toggle = e.target.closest('.stmb-cm-toggle-chat');
                if (!toggle) return;
                e.stopPropagation();
                const key = toggle.dataset.key;
                if (!key) return;
                const stmbData = getSceneMarkers() || {};
                const disabled = Array.isArray(stmbData.disabledContextManager) ? [...stmbData.disabledContextManager] : [];
                if (toggle.checked) {
                    const idx = disabled.indexOf(key);
                    if (idx !== -1) disabled.splice(idx, 1);
                } else {
                    if (!disabled.includes(key)) disabled.push(key);
                }
                stmbData.disabledContextManager = disabled;
                saveMetadataForCurrentContext();
            });

            // Row actions (delegated)
            dlg.addEventListener('click', async (e) => {
                const actionBtn = e.target.closest('.stmb-cm-action');
                const row = e.target.closest('tr[data-tpl-key]');
                if (!row) return;
                const tplKey = row.dataset.tplKey;

                // Highlight
                dlg.querySelectorAll('tr[data-tpl-key]').forEach(r => {
                    r.style.backgroundColor = '';
                });
                row.style.backgroundColor = 'var(--cobalt30a)';

                if (actionBtn) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (actionBtn.classList.contains('stmb-cm-action-edit')) {
                        await openEditTemplate(popup, tplKey);
                    } else if (actionBtn.classList.contains('stmb-cm-action-duplicate')) {
                        const dup = duplicateTemplate(tplKey);
                        if (dup) {
                            toastr.success('Template duplicated', 'STMemoryBooks');
                            refreshList(popup, dup.key);
                        }
                    } else if (actionBtn.classList.contains('stmb-cm-action-delete')) {
                        const confirmPopup = new Popup(
                            `<h3>Delete Template</h3><p>Are you sure you want to delete this template?</p>`,
                            POPUP_TYPE.CONFIRM,
                            '',
                            { okButton: 'Delete', cancelButton: 'Cancel' },
                        );
                        const res = await confirmPopup.show();
                        if (res === POPUP_RESULT.AFFIRMATIVE) {
                            removeTemplate(tplKey);
                            toastr.success('Template deleted', 'STMemoryBooks');
                            refreshList(popup);
                        }
                    }
                    return;
                }
            });
        };

        attachHandlers();
        refreshList(popup);
        await popup.show();
    } catch (error) {
        console.error('STMemoryBooks: Error showing Context Manager:', error);
        toastr.error('Failed to open Context Manager', 'STMemoryBooks');
    }
}
