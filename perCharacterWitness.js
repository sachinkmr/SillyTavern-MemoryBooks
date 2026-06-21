// perCharacterWitness.js — PURE. Single chokepoint for per-character witness
// filtering of a compiled scene, so EVERY side-prompt runner (onInterval,
// runAfterMemory, manual; job and non-job) filters identically. Previously the
// filter snippet was duplicated across four runner sites and missing entirely
// from runAfterMemory + the job-enqueue paths, leaking the full scene to every
// character. Centralizing makes that inconsistency structurally impossible.
import { filterCompiledSceneForCharacter } from './witnessScope.js';

/**
 * PURE. Apply per-character witness filtering to a compiled scene.
 *
 * Passthrough (no filtering) when there is no per-character target or the
 * template has witnessFilter disabled — flag-off behaviour is byte-identical.
 * When filtering leaves zero witnessed messages, signals skip so the caller can
 * drop that character's run rather than summarize an empty scene.
 *
 * @param {object} compiled   compiled scene { metadata, messages:[{id,...}] }
 * @param {{name:string}|null} charTarget  the per-character actor, or null
 * @param {object} tpl        the side-prompt template (reads settings.witnessFilter.enabled)
 * @param {Array}  chat       the live chat array (indexed by message id)
 * @returns {{compiledScene:object, skip:boolean, reason:(string|null), dropped:number}}
 */
export function applyWitnessFilter(compiled, charTarget, tpl, chat) {
    if (!charTarget || !tpl?.settings?.witnessFilter?.enabled) {
        return { compiledScene: compiled, skip: false, reason: null, dropped: 0 };
    }
    const filtered = filterCompiledSceneForCharacter(compiled, chat, charTarget.name);
    if (!filtered || !Array.isArray(filtered.messages) || filtered.messages.length === 0) {
        return {
            compiledScene: filtered ?? compiled,
            skip: true,
            reason: 'no-witnessed-messages',
            dropped: filtered?.metadata?.witnessFiltered ?? 0,
        };
    }
    return {
        compiledScene: filtered,
        skip: false,
        reason: null,
        dropped: filtered.metadata?.witnessFiltered ?? 0,
    };
}
