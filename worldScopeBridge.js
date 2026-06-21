// worldScopeBridge.js — read SillyTavern-WorldScope's CANONICAL active world so
// STMB resolves the world name from a single source of truth instead of each
// derivation heuristic guessing it.
//
// pickWorld is PURE (unit-tested). readActiveWorldName is a GUARDED window read:
// it returns '' under node:test / SSR / when WorldScope is absent or disabled, so
// this module still loads cleanly in node and callers transparently fall back to
// their existing derivation chain (primary + fallback, never a hard replace).

/**
 * PURE: the first non-empty, trimmed string among the candidates, else ''.
 * Used to express "WorldScope first, then the existing fallbacks" uniformly.
 * @param {...*} candidates
 * @returns {string}
 */
export function pickWorld(...candidates) {
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim() !== '') return c.trim();
    }
    return '';
}

/**
 * GUARDED read of `window.WorldScope.activeWorld` (the per-tab world WorldScope
 * publishes). '' when window/WorldScope/activeWorld is unavailable — never throws.
 * @returns {string}
 */
export function readActiveWorldName() {
    try {
        const w = (typeof window !== 'undefined') ? window.WorldScope?.activeWorld : undefined;
        return typeof w === 'string' ? w : '';
    } catch {
        return '';
    }
}
