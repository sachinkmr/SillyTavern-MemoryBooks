/**
 * memoryEntry.js — PURE write-side helpers: turn a witness audience into World Info
 * entry metadata. No SillyTavern imports. See docs/two-plane-memory/.
 */

import { characterFilterName } from './wiFilterName.js';

/**
 * Resolve a (lowercased / first-name) perceiver name to its canonical roster name.
 * Ambiguous first-token (>1 roster member shares the same first name) resolves to null.
 * @param {string} name
 * @param {string[]} roster canonical character (card) names
 * @returns {string|null} canonical name, or null if no roster member matches or first-token is ambiguous
 */
export function canonicalName(name, roster) {
    const n = String(name || '').trim().toLowerCase();
    if (!n || !Array.isArray(roster)) return null;
    // exact (case-insensitive) — unambiguous, always wins
    for (const r of roster) {
        if (String(r).trim().toLowerCase() === n) return r;
    }
    // first-token — resolve ONLY when exactly one roster member matches;
    // ambiguous (>1) or none → null (fail-closed: never guess a wrong target)
    const firstTokenMatches = roster.filter(
        r => String(r).trim().toLowerCase().split(/\s+/)[0] === n,
    );
    return firstTokenMatches.length === 1 ? firstTokenMatches[0] : null;
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

/**
 * Build a World-Info-ready characterFilter from a witness audience, mapping resolved
 * roster members to their AVATAR BASENAME (ST matches getCharaFilename, never display name).
 * @param {string[]} audience perceiver tokens (any case)
 * @param {{name:string,avatar?:string}[]} rosterRows discoverChatCharacters()-style rows
 * @returns {{isExclude:false,names:string[],tags:string[],unresolved:string[]}|null}
 *   null ONLY when audience is empty/missing (fail-open). Non-empty unresolved -> names:[] (N9).
 */
export function buildEntryCharacterFilter(audience, rosterRows) {
    const rows = Array.isArray(rosterRows) ? rosterRows : [];
    const roster = rows.map(r => r && r.name).filter(Boolean);
    const cf = buildCharacterFilter(audience, roster);   // {names: display names}|null
    if (!cf) return null;                                 // fail-open
    const byName = new Map(rows.map(r => [r.name, r]));
    const names = [];
    for (const dn of cf.names) {
        const base = characterFilterName(byName.get(dn));
        if (base && !names.includes(base)) names.push(base);
    }
    return { isExclude: false, names, tags: [], unresolved: cf.unresolved };
}
