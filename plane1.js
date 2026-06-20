// plane1.js
/**
 * plane1.js — Plane-1 (objective shared memory) logic.
 * PURE orchestrator computePlane1Memory has NO SillyTavern imports (fully unit-testable).
 * Impure helpers (getChatRoster / resolveWorldMemoriesBook) are added in Task 4.
 * See docs/two-plane-memory/.
 */
import { dropUnrealFromCompiledScene, filterCompiledSceneForAudience, audienceOf } from './witnessScope.js';
import { buildEntryCharacterFilter } from './memoryEntry.js';

/**
 * Single-segment Plane-1 computation for one scene.
 * @param {object} compiledScene  from compileScene (messages[].id == raw chat index)
 * @param {Array}  chat           live chat array (carries extra.channel)
 * @param {{name:string,avatar?:string}[]} rosterRows  AI characters in the chat
 * @param {{userToken?:string}} opts  lowercased persona/name1 token (kept out of the gate)
 * @returns {{skipped:boolean, reason?:string, filteredScene?:object,
 *            characterFilter?:object|null, audience?:string[]}}
 */
export function computePlane1Memory(compiledScene, chat, rosterRows, opts = {}) {
    const userToken = String(opts.userToken || '').trim().toLowerCase();

    // 1. Reality: drop dream/flashback/story.
    const real = dropUnrealFromCompiledScene(compiledScene, chat);
    if (!real.messages.length) return { skipped: true, reason: 'all-unreal' };

    // 2. Present cast = union of audience tokens actually stamped within the real scene.
    const tokens = new Set();
    for (const cm of real.messages) {
        const aud = audienceOf(chat?.[cm.id]);
        if (aud) for (const t of aud) tokens.add(t);
    }

    // 3. Fully unstamped -> fail-open: whole real scene, no gate.
    if (tokens.size === 0) {
        return { skipped: false, filteredScene: real, characterFilter: null, audience: [] };
    }

    // 4. Input-filter to messages witnessed by the ENTIRE cast (user included).
    const cast = [...tokens];
    const scoped = filterCompiledSceneForAudience(real, chat, cast);
    if (!scoped.messages.length) return { skipped: true, reason: 'no-cast-witnessed' };

    // 5. Gate = cast minus the user (no character turn); mapped to avatar basenames; N9 fail-closed.
    const gateTokens = cast.filter(t => t !== userToken);
    const characterFilter = buildEntryCharacterFilter(gateTokens, rosterRows);

    return { skipped: false, filteredScene: scoped, characterFilter, audience: cast };
}
