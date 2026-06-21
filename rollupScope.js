// rollupScope.js
/**
 * rollupScope.js — Phase 3 witness-correct rollup PLANNING (PURE; no SillyTavern imports).
 * Partition the entries being consolidated into audience-homogeneous FRAGMENTS so a rollup
 * never leaks what a character didn't witness. See docs/two-plane-memory/2026-06-21-phase-3-plan.md.
 *
 * Rule (design doc §3/§13): leaf-sharp / rollup-soft.
 *  - tier <= SHARP_MAX_TIER (chapter): one fragment per distinct audience set; gate each to its audience.
 *  - tier >  SHARP_MAX_TIER (book+):  one UNION fragment; gate to the union audience; "soft" phrasing.
 */

export const SHARP_MAX_TIER = 2; // arc(1)+chapter(2) sharp; book(3)+ union/soft

/** Normalized, sorted, de-duped audience names from an entry's characterFilter. null => everyone (fail-open). */
export function audienceNamesOf(entry) {
    const cf = entry && entry.characterFilter;
    if (!cf || !Array.isArray(cf.names)) return null;
    return [...new Set(cf.names.map(n => String(n)))].sort();
}

/** Stable grouping key. null (everyone) gets its own sentinel bucket. */
function audienceKey(names) {
    return names === null ? ' ALL' : names.join('');
}

/** characterFilter object from a names array; null names => null = ungated. */
function filterFromNames(names) {
    return names === null ? null : { isExclude: false, names: [...names], tags: [] };
}

/**
 * Partition entries into audience-homogeneous groups in first-seen order.
 * Singleton-audience groups are KEPT (shells are legitimately small audiences).
 * @returns {Array<{audience:string[]|null, characterFilter:object|null, entries:object[]}>}
 */
export function partitionByAudience(entries) {
    const groups = new Map();
    const order = [];
    for (const e of (entries || [])) {
        const names = audienceNamesOf(e);
        const key = audienceKey(names);
        if (!groups.has(key)) {
            groups.set(key, { audience: names, characterFilter: filterFromNames(names), entries: [] });
            order.push(key);
        }
        groups.get(key).entries.push(e);
    }
    return order.map(k => groups.get(k));
}

/** Union of all audiences. Any fail-open (null) entry => union is everyone => null. */
export function audienceUnion(entries) {
    const acc = new Set();
    for (const e of (entries || [])) {
        const names = audienceNamesOf(e);
        if (names === null) return null;
        for (const n of names) acc.add(n);
    }
    return [...acc].sort();
}

/**
 * Plan the fragments to produce when consolidating `entries` into `targetTier`.
 * @returns {Array<{audience:string[]|null, characterFilter:object|null, entries:object[], soft:boolean}>}
 */
export function planRollupFragments(entries, targetTier, opts = {}) {
    const sharpMax = Number.isFinite(opts.sharpMaxTier) ? opts.sharpMaxTier : SHARP_MAX_TIER;
    const tier = Number(targetTier) || 0;
    if (tier <= sharpMax) {
        return partitionByAudience(entries).map(g => ({ ...g, soft: false }));
    }
    const names = audienceUnion(entries);
    return [{ audience: names, characterFilter: filterFromNames(names), entries: [...(entries || [])], soft: true }];
}

/** Prompt instruction appended for witness-scoped rollups. soft=true at cold (book+) tiers. */
export function witnessPromptFragment(soft) {
    if (soft) {
        return 'These memories span multiple audiences. Summarize only broad, publicly-known strokes; '
            + 'blur private attribution and do NOT attribute any specific private exchange to anyone.';
    }
    return 'All of these memories were witnessed by the same audience. Write the summary so it reveals '
        + 'nothing beyond what that shared audience already saw.';
}
