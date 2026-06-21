// rollupOrchestrator.js
/**
 * rollupOrchestrator.js — Phase 3 witness-correct rollup ORCHESTRATION (PURE; injected deps).
 * Wraps the existing summarizer: under two-plane, partition the selected entries by audience
 * (rollupScope.planRollupFragments), summarize each fragment separately, and stamp each candidate
 * with the fragment's characterFilter. Flag-off => a single passthrough call (byte-identical).
 *
 * WITNESS-SAFETY SCOPE (important — do NOT over-generalize):
 * The "summarizer only ever sees one audience's content" guarantee holds ONLY at SHARP tiers
 * (tier <= SHARP_MAX_TIER): there planRollupFragments emits one fragment per distinct audience.
 * At book+ (tier > SHARP_MAX_TIER) it INTENTIONALLY emits a single UNION fragment that MIXES
 * audiences and relies on the soft prompt (witnessPromptFragment(true)) to blur private attribution,
 * per the locked E8 decision. A union fragment's candidate is therefore NOT structurally
 * witness-gated content: its characterFilter is the union audience, and it must NOT be treated as
 * safe to redistribute as if it were per-audience witness-scoped.
 */
import { planRollupFragments, witnessPromptFragment, audienceNamesOf, audienceSubsetOf } from './rollupScope.js';

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
        // INPUT-SIDE witness gate (N5/U10 on the multi-pass path): options.lockedSummaries carries
        // accepted summaries from prior preview/regenerate/retry passes, possibly across OTHER audience
        // fragments; arcanalysis injects each as canon into the LLM prompt. A locked summary L may seed
        // fragment F ONLY IF every reader of F also witnessed L, i.e. F.audience is a subset of L.audience.
        // Filter per fragment; never introduce the key if options had no lockedSummaries array.
        if (Array.isArray(options.lockedSummaries)) {
            fragOptions.lockedSummaries = options.lockedSummaries.filter(
                L => audienceSubsetOf(frag.audience, audienceNamesOf(L)),
            );
        }
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
