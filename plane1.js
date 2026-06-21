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

/**
 * Segment a scene into contiguous audience-homogeneous runs; one objective gated entry per run.
 * Generalizes computePlane1Memory (1a). Drops single-perceiver runs (Plane-2 material).
 * Unstamped messages extend the current run (fail-open). A leading unstamped run is ungated.
 * @returns {Array<{filteredScene, characterFilter, audience:string[], sceneStart, sceneEnd, segmentIndex}>}
 *   empty array when nothing to record (all-unreal or all single-perceiver).
 */
export function computePlane1Segments(compiledScene, chat, rosterRows, opts = {}) {
    const userToken = String(opts.userToken || '').trim().toLowerCase();
    const real = dropUnrealFromCompiledScene(compiledScene, chat);
    if (!real.messages.length) return [];

    // 1. Split into contiguous runs of identical audience composition.
    const runs = [];
    let cur = null;
    for (const cm of real.messages) {
        const aud = audienceOf(chat?.[cm.id]);                                  // lowercased[] | null
        const tokens = aud === null ? null : [...new Set(aud)].sort();
        const key = tokens === null ? null : tokens.join(' ');
        if (cur && (aud === null || key === cur.key)) {
            cur.messages.push(cm);                                              // extend (same set, or unstamped)
        } else {
            cur = { key, tokens, messages: [cm] };
            runs.push(cur);
        }
    }

    // Phase 2 follow-up: merge same-audience runs separated ONLY by directed gaps (whisper/DM/text
    // where those members stayed PRESENT, i.e. present_cast covers them) — never across a real exit.
    const runIsDirectedCovering = (run, setTokens) => {
        for (const cm of run.messages) {
            const pc = chat?.[cm.id]?.extra?.channel?.present_cast;
            if (!Array.isArray(pc)) return false;                       // not a directed gap → treat as exit
            const pcl = pc.map(n => String(n).toLowerCase());
            for (const m of setTokens) if (!pcl.includes(m)) return false;  // a member wasn't present → exit
        }
        return true;
    };
    const mergedRuns = [];
    for (const run of runs) {
        let target = -1;
        if (run.key !== null) {                                          // never merge fail-open (null-key) runs
            const between = [];
            for (let j = mergedRuns.length - 1; j >= 0; j--) {
                if (mergedRuns[j].key === run.key) {
                    if (between.every(b => runIsDirectedCovering(b, run.tokens))) target = j;
                    break;
                }
                between.push(mergedRuns[j]);
            }
        }
        if (target >= 0) mergedRuns[target].messages = mergedRuns[target].messages.concat(run.messages);
        else mergedRuns.push(run);
    }

    // 2. One segment per run; drop single-perceiver runs.
    const segments = [];
    for (const run of mergedRuns) {
        const audience = run.tokens;                                            // null => fail-open run
        if (audience && audience.length === 1) continue;                        // single perceiver → drop
        const ids = run.messages.map(m => m.id);
        const filteredScene = {
            ...real,
            messages: run.messages,
            metadata: {
                ...real.metadata,
                messageCount: run.messages.length,
                sceneStart: ids[0],
                sceneEnd: ids[ids.length - 1],
            },
        };
        const characterFilter = audience
            ? buildEntryCharacterFilter(audience.filter(t => t !== userToken), rosterRows)
            : null;                                                             // fail-open run → ungated
        segments.push({
            filteredScene,
            characterFilter,
            audience: audience || [],   // null tokens (fail-open run) → [] = no restriction (everyone)
            sceneStart: ids[0],
            sceneEnd: ids[ids.length - 1],
            segmentIndex: segments.length,
        });
    }
    return segments;
}

/**
 * Choose the memory write target. In two-plane mode, prefer the shared <World> - Memories book
 * (resolveWorld); only fall back to the legacy chat-bound validator (which may prompt) when no
 * world resolves. PURE + dependency-injected so it's unit-testable; the impure deps are passed in.
 * Key contract: when twoPlane AND a world book resolves, legacyValidate is NOT called (so the
 * chat-bound "select a lorebook" popup never fires in two-plane mode).
 * @param {{twoPlane:boolean, resolveWorld:()=>Promise<any|null>, legacyValidate:()=>Promise<any>}} deps
 * @returns {Promise<any>} the lorebookValidation object ({valid,name,data} | {valid:false,...})
 */
export async function resolveMemoryLorebook({ twoPlane, resolveWorld, legacyValidate }) {
    if (twoPlane) {
        const wb = await resolveWorld();
        if (wb) return wb;                       // world book resolved → skip the legacy chat-bound gate/popup
    }
    return legacyValidate();
}
