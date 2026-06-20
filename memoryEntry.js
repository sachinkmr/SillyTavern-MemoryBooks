/**
 * memoryEntry.js — PURE write-side helpers: turn a witness audience into World Info
 * entry metadata. No SillyTavern imports. See docs/two-plane-memory/.
 */

/**
 * Resolve a (lowercased / first-name) perceiver name to its canonical roster name.
 * @param {string} name
 * @param {string[]} roster canonical character (card) names
 * @returns {string|null} canonical name, or null if no roster member matches
 */
export function canonicalName(name, roster) {
    const n = String(name || '').trim().toLowerCase();
    if (!n || !Array.isArray(roster)) return null;
    for (const r of roster) {                                   // exact, case-insensitive
        if (String(r).trim().toLowerCase() === n) return r;
    }
    for (const r of roster) {                                   // first-token (card first name)
        if (String(r).trim().toLowerCase().split(/\s+/)[0] === n) return r;
    }
    return null;
}

/**
 * Build a World Info characterFilter from a witness audience.
 * @param {string[]} audience perceiver names (any case)
 * @param {string[]} roster canonical character (card) names
 * @returns {{isExclude:boolean,names:string[],tags:string[],unresolved:string[]}|null}
 *   null ONLY when audience is empty/missing (fail-open = everyone). A non-empty
 *   audience always returns an object (FAIL-CLOSED, N9): unresolved names are kept
 *   out of `names` (so they match nobody, never everybody) and listed in `unresolved`.
 */
export function buildCharacterFilter(audience, roster) {
    if (!Array.isArray(audience) || audience.length === 0) return null;   // fail-open
    const names = [];
    const unresolved = [];
    for (const a of audience) {
        const c = canonicalName(a, roster);
        if (c) { if (!names.includes(c)) names.push(c); }
        else { unresolved.push(a); }
    }
    return { isExclude: false, names, tags: [], unresolved };             // fail-closed
}
