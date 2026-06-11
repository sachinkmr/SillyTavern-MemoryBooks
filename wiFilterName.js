/**
 * WI characterFilter name resolution. PURE module — no SillyTavern imports.
 *
 * SillyTavern's world-info characterFilter matches `getCharaFilename()` — the card's
 * AVATAR FILE basename (world-info.js:4705) — never the display name and never a persona
 * name. A display-name filter is permanently dead (the entry can never activate), and ST
 * silently strips unresolvable filter names on some UI paths.
 *
 * Live-found 2026-06-11 (clean-slate campaign): the per-character actor tracker wrote
 * `characterFilter: { names: ['Priya Mehta'] }` — the card's display name — for the one
 * cast member whose display name differs from her avatar file (Priya.png). Her tracker
 * entry could therefore never inject. Every other card is a mononym (name == basename),
 * which is why draft-scoping tests passed.
 */

/**
 * Resolve the characterFilter name for a chat character target.
 * @param {{name?: string, avatar?: string}|null|undefined} charTarget
 *   discoverChatCharacters() row: `avatar` is the PNG filename ('Priya.png'); `name` is
 *   the display name ('Priya Mehta').
 * @returns {string|null} the avatar basename when available, else the display name as a
 *   best-effort fallback (correct for mononym cards), else null.
 */
export function characterFilterName(charTarget) {
    if (!charTarget) return null;
    const avatar = typeof charTarget.avatar === 'string' ? charTarget.avatar.trim() : '';
    if (avatar) {
        const base = avatar.replace(/\.[^./\\]+$/, '');
        if (base) return base;
    }
    const name = typeof charTarget.name === 'string' ? charTarget.name.trim() : '';
    return name || null;
}
