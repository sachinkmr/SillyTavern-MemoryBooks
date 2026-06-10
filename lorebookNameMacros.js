/**
 * Macro resolution for `settings.lorebookOverride.lorebookNames` strings.
 * PURE module — no SillyTavern imports; callers pass the live context.
 *
 * Supported macros (case-insensitive, inner whitespace tolerated):
 *   {{group}} — the current group chat's NAME (e.g. "🏠 TWW2"). This is NOT
 *               SillyTavern's native {{group}} macro (which expands to a
 *               member-name list); resolution is custom and must never be
 *               passed through substituteParams. In a solo (non-group) chat,
 *               {{group}} falls back to the current character's name.
 *   {{char}}  — the actor's name when resolved inside the per-character actor
 *               loop (callers pass it); otherwise the card character's name.
 *
 * Contract: when a macro has no context value to resolve with, the token is
 * left INTACT. The unresolved literal then fails the caller's world_names
 * existence-validation, which logs a warning and falls back to the existing
 * default routing behavior (no auto-creation of lorebooks).
 */

const GROUP_MACRO = /{{\s*group\s*}}/gi;
const CHAR_MACRO = /{{\s*char\s*}}/gi;

/** True when the name contains a {{group}} or {{char}} token. */
export function hasLorebookNameMacros(name) {
    const s = String(name ?? '');
    // Fresh RegExp objects per call would also work; reset lastIndex on the
    // shared global regexes instead to keep allocations out of hot paths.
    GROUP_MACRO.lastIndex = 0;
    CHAR_MACRO.lastIndex = 0;
    return GROUP_MACRO.test(s) || CHAR_MACRO.test(s);
}

/**
 * Resolve {{group}}/{{char}} in a single lorebook name.
 * @param {string} name - Raw lorebook name, possibly containing macros
 * @param {{ groupName?: string|null, charName?: string|null }} context
 * @returns {string} Resolved name; unresolvable tokens are left intact.
 */
export function resolveLorebookNameMacros(name, context = {}) {
    let out = String(name ?? '');
    const groupName = String(context?.groupName ?? '').trim();
    const charName = String(context?.charName ?? '').trim();
    const groupValue = groupName || charName; // solo-chat fallback
    if (groupValue) out = out.replace(GROUP_MACRO, groupValue);
    if (charName) out = out.replace(CHAR_MACRO, charName);
    return out;
}

/**
 * Resolve a lorebookNames array: per-name macro resolution, trim, drop
 * non-strings/empties, and dedupe AFTER resolution (two raw names may
 * resolve to the same book).
 * @param {string[]} names
 * @param {{ groupName?: string|null, charName?: string|null }} context
 * @returns {string[]}
 */
export function resolveLorebookNameList(names, context = {}) {
    if (!Array.isArray(names)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const resolved = resolveLorebookNameMacros(raw, context).trim();
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        out.push(resolved);
    }
    return out;
}
