// plane1Activation.js
/**
 * plane1Activation.js — PURE decision logic for Phase 4a world-book auto-attach.
 *
 * This module has NO SillyTavern imports and MUST load under `node --test`.
 * It decides, given the resolved "<World> - Memories" book, the currently-active
 * memory books in ST's GLOBAL active-worlds set (selected_world_info), and the
 * two-plane flag, WHICH memory books to add to / remove from that set.
 *
 * The live ST mutation (push/splice on selected_world_info + saveSettingsDebounced
 * + WORLDINFO_SETTINGS_UPDATED emit) is performed by the impure wiring in
 * plane1Context.js — see applyWorldBookActivation(). The mechanism is documented
 * in docs/two-plane-memory/ and derived from ST's own onWorldInfoChange()
 * (public/scripts/world-info.js).
 *
 * Design invariants enforced here:
 *   - PER-WORLD: entering world W activates "W - Memories" and deactivates every
 *     OTHER "* - Memories" book (no cross-world leak).
 *   - ADDITIVE: this function only ever reasons about MEMORY books (names ending
 *     in the memory suffix). Non-memory books (the user's own chat-bound /
 *     character / persona lorebooks) are NEVER in toActivate/toDeactivate, so the
 *     caller can never clobber them.
 *   - IDEMPOTENT: if the target book is already the sole active memory book, both
 *     lists are empty (no-op).
 *   - FLAG-OFF: isTwoPlane === false => { toActivate: [], toDeactivate: [] }.
 *     (Caller must therefore make ZERO live activation calls when flag is off.)
 */

/** Suffix that marks a two-plane memory book. Mirrors plane1Context.js naming. */
export const MEMORY_BOOK_SUFFIX = ' - Memories';

/**
 * True iff `name` is a two-plane memory book (ends with " - Memories").
 * @param {string} name
 * @returns {boolean}
 */
export function isMemoryBookName(name) {
    return typeof name === 'string' && name.endsWith(MEMORY_BOOK_SUFFIX);
}

/**
 * Compute the COMPLETE next active-worlds set for the DOM-driven activation path
 * (the proven SillyTavern-WorldScope mechanism: `$('#world_info').val(indices)
 * .trigger('change')`, which makes ST's own onWorldInfoChange() REBUILD
 * selected_world_info from the multiselect's selected option values).
 *
 * That path needs the FULL next set — not a delta — because ST replaces the
 * selection wholesale from the DOM. This helper preserves EVERY non-memory book
 * (the user's own chat-bound / character / persona / engine lorebooks, in their
 * original order), drops every OTHER "* - Memories" book (per-world hygiene), and
 * appends the resolved target memory book. De-duplicated, order-stable.
 *
 * Contrast computeWorldBookActivation() below, which returns an additive DELTA
 * for the in-place push/splice fallback used when the #world_info select2 widget
 * is not rendered yet (chat-open before the WI panel is opened).
 *
 * @param {object} args
 * @param {{name:string}|string|null} args.resolvedWorldBook  the "<World> - Memories" book.
 * @param {string[]} args.currentActive  the FULL current selected_world_info (all books).
 * @param {boolean} args.isTwoPlane  the twoPlaneMemory feature flag.
 * @returns {string[]}  the complete next active-worlds set, or a copy of
 *   currentActive (untouched) when the flag is off.
 */
export function computeNextActiveWorlds({ resolvedWorldBook, currentActive, isTwoPlane } = {}) {
    const current = (Array.isArray(currentActive) ? currentActive : []).filter(
        (n) => typeof n === 'string' && n.length > 0,
    );
    // FLAG-OFF: never touch the set — return it verbatim (caller short-circuits
    // before ever reaching here, but be defensive).
    if (!isTwoPlane) {
        return Array.from(new Set(current));
    }

    const target = resolvedWorldBook == null
        ? null
        : (typeof resolvedWorldBook === 'string' ? resolvedWorldBook : resolvedWorldBook.name);
    const targetValid = isMemoryBookName(target) ? target : null;

    const out = [];
    const seen = new Set();
    // Preserve every NON-memory book in original order; drop every memory book
    // here (the target, if valid, is re-appended below so it lands last/active).
    for (const name of current) {
        if (isMemoryBookName(name)) continue;     // memory books handled below
        if (seen.has(name)) continue;
        out.push(name);
        seen.add(name);
    }
    if (targetValid && !seen.has(targetValid)) {
        out.push(targetValid);
        seen.add(targetValid);
    }
    return out;
}

/**
 * Compute the additive/idempotent/per-world activation delta for the world
 * memory book against the currently-active MEMORY books.
 *
 * IMPORTANT: `currentlyActiveMemoryBooks` should be the memory books that are
 * currently in ST's GLOBAL active set (selected_world_info filtered to memory
 * books). The caller filters non-memory books out BEFORE calling, which is what
 * guarantees this helper can never schedule a non-memory book for removal.
 *
 * @param {object} args
 * @param {{name:string}|string|null} args.resolvedWorldBook
 *   The resolved "<World> - Memories" book (object with .name, or a bare name,
 *   or null when no world resolves).
 * @param {string[]} args.currentlyActiveMemoryBooks
 *   Memory book names currently active in selected_world_info.
 * @param {boolean} args.isTwoPlane  The twoPlaneMemory feature flag.
 * @returns {{toActivate:string[], toDeactivate:string[]}}
 */
export function computeWorldBookActivation({ resolvedWorldBook, currentlyActiveMemoryBooks, isTwoPlane } = {}) {
    // FLAG-OFF: byte-identical behaviour to pre-Phase-4a — no activation, no
    // deactivation. The caller short-circuits and makes zero live calls.
    if (!isTwoPlane) {
        return { toActivate: [], toDeactivate: [] };
    }

    // Normalise the active set: keep only well-formed memory book names, dedup.
    const active = Array.from(new Set(
        (Array.isArray(currentlyActiveMemoryBooks) ? currentlyActiveMemoryBooks : [])
            .filter(isMemoryBookName),
    ));

    // Resolve the target name from object|string|null.
    const target = resolvedWorldBook == null
        ? null
        : (typeof resolvedWorldBook === 'string' ? resolvedWorldBook : resolvedWorldBook.name);
    const targetValid = isMemoryBookName(target) ? target : null;

    // PER-WORLD: every active memory book that is NOT the target must be removed
    // (covers the cross-world switch: "OldWorld - Memories" leaves when we enter
    // "NewWorld - Memories"). When no world resolves (targetValid === null), this
    // removes ALL memory books — i.e. we stop leaking the previous world's book.
    const toDeactivate = active.filter(name => name !== targetValid);

    // ADDITIVE + IDEMPOTENT: activate the target only when it resolves AND is not
    // already active.
    const toActivate = (targetValid && !active.includes(targetValid)) ? [targetValid] : [];

    return { toActivate, toDeactivate };
}
