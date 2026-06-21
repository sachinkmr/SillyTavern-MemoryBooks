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
