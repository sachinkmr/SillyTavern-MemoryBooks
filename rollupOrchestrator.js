// rollupOrchestrator.js
/**
 * rollupOrchestrator.js — Phase 3 witness-correct rollup ORCHESTRATION (PURE; injected deps).
 * Wraps the existing summarizer: under two-plane, partition the selected entries by audience
 * (rollupScope.planRollupFragments), summarize each fragment separately (so the summarizer only
 * ever sees one audience's content), and stamp each candidate with the fragment's characterFilter.
 * Flag-off => a single passthrough call to the legacy summarizer (byte-identical).
 */
import { planRollupFragments, witnessPromptFragment } from './rollupScope.js';

/** Per-candidate shallow clone of a fragment's characterFilter so siblings never alias.
 * The committed-summary write path (Task 3) assigns this straight into entryOverrides.characterFilter,
 * and SillyTavern entry-write/normalization may mutate filter objects in place; sharing one reference
 * across a fragment's candidates would let an in-place edit of one corrupt its siblings. null = ungated. */
function cloneFilter(cf) {
    if (!cf) return cf; // null/undefined => ungated, pass through unchanged
    return { ...cf, names: Array.isArray(cf.names) ? [...cf.names] : cf.names };
}

/**
 * @param {object[]} selectedEntries  source lorebook entries the user chose to consolidate
 * @param {object}   options          summarizer options (must carry targetTier)
 * @param {*}        conn             profile/connection passthrough for the summarizer
 * @param {{summarize:Function, isTwoPlane:Function, sharpMaxTier?:number}} deps
 * @returns {Promise<{summaryCandidates:object[], leftovers:any[], rawText:string, retryRawText:string}>}
 */
export async function runWitnessRollup(selectedEntries, options, conn, deps) {
    const { summarize, isTwoPlane } = deps;
    if (!isTwoPlane()) {
        return summarize(selectedEntries, options, conn); // legacy path, untouched
    }
    const fragments = planRollupFragments(selectedEntries, options?.targetTier, { sharpMaxTier: deps.sharpMaxTier });
    const summaryCandidates = [];
    const leftovers = [];
    // Carry the summarizer's debug fields forward so the "view failed response" popup is non-empty
    // when a rollup yields zero usable summaries (back-compat with the flag-off passthrough, which
    // returns {..., rawText, retryRawText} from runSummaryAnalysisSequential). Concatenate per fragment.
    const rawTextParts = [];
    const retryRawTextParts = [];
    for (const frag of fragments) {
        const fragOptions = { ...options, witnessPrompt: witnessPromptFragment(frag.soft) };
        const res = await summarize(frag.entries, fragOptions, conn);
        for (const cand of (res?.summaryCandidates || [])) {
            summaryCandidates.push({ ...cand, characterFilter: cloneFilter(frag.characterFilter), witnessSoft: frag.soft });
        }
        if (Array.isArray(res?.leftovers)) leftovers.push(...res.leftovers);
        if (res?.rawText) rawTextParts.push(String(res.rawText));
        if (res?.retryRawText) retryRawTextParts.push(String(res.retryRawText));
    }
    return {
        summaryCandidates,
        leftovers,
        rawText: rawTextParts.join('\n\n'),
        retryRawText: retryRawTextParts.join('\n\n'),
    };
}
