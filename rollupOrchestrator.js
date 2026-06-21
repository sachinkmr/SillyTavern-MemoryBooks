// rollupOrchestrator.js
/**
 * rollupOrchestrator.js — Phase 3 witness-correct rollup ORCHESTRATION (PURE; injected deps).
 * Wraps the existing summarizer: under two-plane, partition the selected entries by audience
 * (rollupScope.planRollupFragments), summarize each fragment separately (so the summarizer only
 * ever sees one audience's content), and stamp each candidate with the fragment's characterFilter.
 * Flag-off => a single passthrough call to the legacy summarizer (byte-identical).
 */
import { planRollupFragments, witnessPromptFragment } from './rollupScope.js';

/**
 * @param {object[]} selectedEntries  source lorebook entries the user chose to consolidate
 * @param {object}   options          summarizer options (must carry targetTier)
 * @param {*}        conn             profile/connection passthrough for the summarizer
 * @param {{summarize:Function, isTwoPlane:Function, sharpMaxTier?:number}} deps
 * @returns {Promise<{summaryCandidates:object[], leftovers:any[]}>}
 */
export async function runWitnessRollup(selectedEntries, options, conn, deps) {
    const { summarize, isTwoPlane } = deps;
    if (!isTwoPlane()) {
        return summarize(selectedEntries, options, conn); // legacy path, untouched
    }
    const fragments = planRollupFragments(selectedEntries, options?.targetTier, { sharpMaxTier: deps.sharpMaxTier });
    const summaryCandidates = [];
    const leftovers = [];
    for (const frag of fragments) {
        const fragOptions = { ...options, witnessPrompt: witnessPromptFragment(frag.soft) };
        const res = await summarize(frag.entries, fragOptions, conn);
        for (const cand of (res?.summaryCandidates || [])) {
            summaryCandidates.push({ ...cand, characterFilter: frag.characterFilter, witnessSoft: frag.soft });
        }
        if (Array.isArray(res?.leftovers)) leftovers.push(...res.leftovers);
    }
    return { summaryCandidates, leftovers };
}
