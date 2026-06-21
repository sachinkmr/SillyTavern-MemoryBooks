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
 * Option A (solo = 1-member group): derive the WORLD PREFIX from a chat-bound
 * lorebook name, so a solo chat can resolve {{group}} to the same value the
 * group chat uses (the world name, e.g. '🏠 TWW2') instead of the card char
 * name. Only the canonical world books derive — names ending EXACTLY in
 * ' - Core' or ' - Memories':
 *   '🏠 TWW2 - Core'     → '🏠 TWW2'
 *   '🏠 TWW2 - Memories' → '🏠 TWW2'
 *   '🏠 TWW2 - Shilpa'   → null   (character book — not a world anchor)
 *   'X - Core - Y'       → null   (suffix only, never mid-string)
 * @param {string|null|undefined} bookName - chat-bound lorebook name
 * @returns {string|null} the world prefix, or null when not derivable
 */
export function deriveWorldPrefix(bookName) {
    if (typeof bookName !== 'string') return null;
    const m = bookName.match(/^(.+) - (?:Core|Memories)$/);
    return m ? m[1] : null;
}

/**
 * Name of the first folder-type tag mapped to entityKey (ST tag-folder), or null.
 * PURE / defensive: never throws; returns null on any missing/malformed input.
 *
 * @param {string|null|undefined} entityKey - character avatar filename (solo) or group id (group)
 * @param {Object|null|undefined} tagMap    - tag_map from ST tags.js (entityKey → tagId[])
 * @param {Array|null|undefined}  tagList   - tags array from ST tags.js ({id, name, folder_type}[])
 * @returns {string|null}
 */
export function pickFolderName(entityKey, tagMap, tagList) {
    if (!entityKey || !tagMap || !Array.isArray(tagList)) return null;
    const ids = Array.isArray(tagMap[entityKey]) ? tagMap[entityKey] : [];
    if (!ids.length) return null;
    for (const t of tagList) {
        if (!t || !ids.includes(t.id)) continue;
        const ft = t.folder_type ? String(t.folder_type).toUpperCase() : '';
        if (ft && ft !== 'NONE') return (typeof t.name === 'string' && t.name.trim()) ? t.name.trim() : null;
    }
    return null;
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
