/**
 * plane1Context.js — Impure resolvers for Phase 1a two-plane memory.
 *
 * This file MUST remain separate from plane1.js (which is pure and must
 * load under `node --test` without SillyTavern imports). These functions
 * depend on live SillyTavern globals and cannot be unit-tested in isolation.
 *
 * Exports:
 *   getChatRoster()            → {name, avatar}[]
 *   currentFolderName()        → string|null
 *   resolveWorldMemoriesBook() → Promise<{valid:true, name, data}|null>
 */

// Import specifiers copied verbatim from sidePrompts.js lines 1, 3, 5
import { chat_metadata, characters, this_chid, name2, eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
// Phase 4a: selected_world_info is ST's GLOBAL active-worlds array — the set
// getGlobalLore() iterates at generation time (public/scripts/world-info.js:4414).
// It is `export let selected_world_info = []` (world-info.js:66) and ST mutates it
// IN PLACE via push/splice in onWorldInfoChange() (the /world command, ~line 5665+),
// then saveSettingsDebounced() + emit(WORLDINFO_SETTINGS_UPDATED). We follow the
// SAME in-place pattern so we mutate the exact array instance the WI engine reads.
import { METADATA_KEY, world_names, loadWorldInfo, createNewWorldInfo, selected_world_info } from '../../../world-info.js';
import { selected_group, groups } from '../../../group-chats.js';
// Defensive NAMESPACE import: tags.js lives alongside world-info.js / group-chats.js in the ST
// root (path mirrors sibling imports above). Namespace (not named) import so a missing/renamed
// export (tags / tag_map) degrades to `undefined` at use — the folder feature simply turns off —
// instead of failing at MODULE LOAD (a named import of a non-existent export throws on load,
// which try/catch can't catch and would break ALL two-plane writes, not just folder derivation).
import * as _stTags from '../../../tags.js';

// Local imports
import { deriveWorldPrefix, pickFolderName } from './lorebookNameMacros.js';
import { getCurrentMemoryBooksContext } from './utils.js';
import { computeWorldBookActivation, isMemoryBookName } from './plane1Activation.js';

/**
 * AI characters in the current chat: {name, avatar}[].
 * Solo: [characters[this_chid]]; Group: selected_group members → characters.
 * Mirrors discoverChatCharacters() in sidePrompts.js:132-173.
 */
export function getChatRoster() {
    if (selected_group) {
        const group = (groups || []).find(g => g.id === selected_group);
        const members = group?.members || [];
        return members
            .map(av => {
                const c = (characters || []).find(ch => ch.avatar === av);
                return c?.name ? { name: c.name, avatar: c.avatar } : null; // mirror discoverChatCharacters' name guard
            })
            .filter(Boolean);
    }
    // Solo: prefer the active card; fall back to name2 (avatar '') — mirrors discoverChatCharacters.
    const c = (this_chid !== undefined) ? characters?.[this_chid] : null;
    if (c?.name) return [{ name: c.name, avatar: c.avatar }];
    if (name2 && String(name2).trim()) return [{ name: String(name2).trim(), avatar: '' }];
    return [];
}

/**
 * Returns the name of the ST tag-folder the active character/group sits in,
 * or null when no folder tag is found or any access fails.
 *
 * IMPURE — reads ST globals (selected_group, characters, this_chid, tags, tag_map).
 * Fully defensive: a try/catch guards every path so a missing tags.js export or
 * an unexpected ST data shape can never propagate as an exception.
 *
 * @returns {string|null}
 */
export function currentFolderName() {
    try {
        const entityKey = selected_group
            ? selected_group
            : characters?.[this_chid]?.avatar;
        return pickFolderName(entityKey, _stTags?.tag_map, _stTags?.tags);
    } catch (_) {
        return null;
    }
}

/**
 * Resolve/create/load the shared "<World> - Memories" lorebook.
 * World name priority:
 *   1. Tag-folder name the active character/group sits in (cross-folder sharing)
 *   2. Group name (group chat)
 *   3. Chat-bound lorebook prefix (solo "Option A" world anchor)
 *   4. Character name
 * Does NOT rebind chat_metadata[METADATA_KEY] (contrast autoCreateLorebook
 * in autocreate.js which does rebind — we call createNewWorldInfo directly).
 * @returns {Promise<{valid:true, name:string, data:object}|null>}
 */
export async function resolveWorldMemoriesBook() {
    const ctx = getCurrentMemoryBooksContext();
    const world = currentFolderName()
        || (ctx?.isGroupChat && ctx.groupName ? ctx.groupName : null)
        || deriveWorldPrefix(chat_metadata?.[METADATA_KEY])
        || ctx?.characterName;
    if (!world) return null;
    const name = `${world} - Memories`;
    if (!(world_names || []).includes(name)) {
        await createNewWorldInfo(name);          // creates the book; does NOT touch chat_metadata
    }
    const data = await loadWorldInfo(name);
    if (!data) return null;
    return { valid: true, name, data };
}

/**
 * Sync the "#world_info" multiselect DOM option's selected state for one world,
 * mirroring ST's own onWorldInfoChange() which does
 * `wiElement.prop('selected', bool)` alongside the selected_world_info mutation.
 * Defensive: the WI drawer may not be rendered yet (chat-open before the user
 * opens the panel). selected_world_info is the source of truth the engine reads;
 * the DOM sync is best-effort so the panel checkbox visually matches. A missing
 * jQuery / option is a silent no-op.
 * @param {string} bookName
 * @param {boolean} on
 */
function _syncWorldInfoSelectOption(bookName, on) {
    try {
        const $ = (typeof window !== 'undefined' && window.jQuery) ? window.jQuery
            : (typeof jQuery !== 'undefined' ? jQuery : null);   // eslint-disable-line no-undef
        if (!$ || !Array.isArray(world_names)) return;
        const idx = world_names.indexOf(bookName);
        if (idx < 0) return;
        const $opt = $('#world_info').find(`option[value="${idx}"]`);
        if ($opt.length) $opt.prop('selected', !!on);
    } catch (_) { /* DOM not ready — selected_world_info is still authoritative */ }
}

/**
 * Phase 4a — LIVE auto-attach of the "<World> - Memories" book to ST's GLOBAL
 * active-worlds set for inference, per-world and additive.
 *
 * Flow:
 *   1. FLAG-OFF SHORT-CIRCUIT — when !isTwoPlane we return immediately BEFORE
 *      touching selected_world_info, before any emit/save: byte-identical to
 *      pre-Phase-4a (zero activation calls). The pure helper also returns a
 *      no-op for flag-off, but we short-circuit here so the flag-off path makes
 *      ZERO live ST calls of any kind.
 *   2. Read the MEMORY books currently in selected_world_info.
 *   3. Ask the PURE helper (computeWorldBookActivation) for { toActivate,
 *      toDeactivate } — additive / idempotent / per-world.
 *   4. Apply in place on the SAME selected_world_info array instance the engine
 *      reads (push to add, splice to remove), mirror the #world_info DOM option,
 *      then persist (saveSettingsDebounced) + emit WORLDINFO_SETTINGS_UPDATED —
 *      exactly as ST's onWorldInfoChange() does for the /world command.
 *
 * Non-memory books (the user's own chat-bound book via chat_metadata[
 * METADATA_KEY], character/persona lorebooks) are NEVER in the delta — we only
 * ever read/write names ending in " - Memories" — so this can never clobber a
 * user's own lorebook. ST's getChatLore() separately injects chat_metadata[
 * METADATA_KEY] and explicitly skips it if it's already in selected_world_info,
 * so there is no double-inject either.
 *
 * IMPURE — reads/mutates ST globals. Wrapped so a failure can never break chat
 * load. Returns the applied delta (handy for logging / live verification).
 *
 * @param {{ isTwoPlane: boolean }} opts  the twoPlaneMemory flag, passed in so
 *   this module stays decoupled from the flag's storage location.
 * @returns {Promise<{toActivate:string[], toDeactivate:string[], changed:boolean}>}
 */
export async function applyWorldBookActivation({ isTwoPlane } = {}) {
    const NOOP = { toActivate: [], toDeactivate: [], changed: false };
    // (1) FLAG-OFF: zero live calls. resolveWorldMemoriesBook() can CREATE a book,
    // so we must not even resolve when the flag is off.
    if (!isTwoPlane) return NOOP;

    try {
        // (2) Resolve the world book for the current chat (may create+load it).
        const resolved = await resolveWorldMemoriesBook();   // {valid,name,data}|null

        // selected_world_info is a live binding to ST's active array. Read the
        // memory books currently in it (the helper double-guards, but pre-filter
        // so non-memory books are provably out of scope).
        const activeAll = Array.isArray(selected_world_info) ? selected_world_info : [];
        const currentlyActiveMemoryBooks = activeAll.filter(isMemoryBookName);

        // (3) PURE decision.
        const { toActivate, toDeactivate } = computeWorldBookActivation({
            resolvedWorldBook: resolved && resolved.name ? resolved.name : null,
            currentlyActiveMemoryBooks,
            isTwoPlane: true,
        });

        if (toActivate.length === 0 && toDeactivate.length === 0) return NOOP;

        // (4) Apply IN PLACE on the same array instance the WI engine reads.
        for (const name of toDeactivate) {
            const i = selected_world_info.indexOf(name);
            if (i >= 0) selected_world_info.splice(i, 1);
            _syncWorldInfoSelectOption(name, false);
        }
        for (const name of toActivate) {
            if (!selected_world_info.includes(name)) selected_world_info.push(name);
            _syncWorldInfoSelectOption(name, true);
        }

        // Persist + announce, exactly as ST's onWorldInfoChange() does.
        try { saveSettingsDebounced?.(); } catch (_) { /* non-fatal */ }
        try { eventSource?.emit?.(event_types?.WORLDINFO_SETTINGS_UPDATED); } catch (_) { /* non-fatal */ }

        console.log(
            `STMemoryBooks: two-plane world-book activation — +[${toActivate.join(', ')}] -[${toDeactivate.join(', ')}]`,
        );
        return { toActivate, toDeactivate, changed: true };
    } catch (e) {
        console.warn('STMemoryBooks: applyWorldBookActivation failed (non-fatal):', e);
        return NOOP;
    }
}
