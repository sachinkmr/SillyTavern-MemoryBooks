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
import { pickWorld, readActiveWorldName } from './worldScopeBridge.js';
import { getCurrentMemoryBooksContext } from './utils.js';
import { computeWorldBookActivation, computeNextActiveWorlds, isMemoryBookName } from './plane1Activation.js';

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
 *   1. SillyTavern-WorldScope active world (window.WorldScope.activeWorld) — canonical
 *   2. Tag-folder name the active character/group sits in (cross-folder sharing)
 *   3. Group name (group chat)
 *   4. Chat-bound lorebook prefix (solo "Option A" world anchor)
 *   5. Character name
 * Does NOT rebind chat_metadata[METADATA_KEY] (contrast autoCreateLorebook
 * in autocreate.js which does rebind — we call createNewWorldInfo directly).
 * @returns {Promise<{valid:true, name:string, data:object}|null>}
 */
export async function resolveWorldMemoriesBook() {
    const ctx = getCurrentMemoryBooksContext();
    // WorldScope's canonical active world FIRST; fall back to the existing
    // derivation chain when WorldScope is absent/empty (primary + fallback).
    const world = pickWorld(
        readActiveWorldName(),
        currentFolderName(),
        (ctx?.isGroupChat && ctx.groupName) ? ctx.groupName : null,
        deriveWorldPrefix(chat_metadata?.[METADATA_KEY]),
        ctx?.characterName,
    );
    if (!world) return null;
    const name = `${world} - Memories`;
    if (!(world_names || []).includes(name)) {
        await createNewWorldInfo(name);          // creates the book; does NOT touch chat_metadata
    }
    const data = await loadWorldInfo(name);
    if (!data) return null;
    return { valid: true, name, data };
}

/** Resolve the global jQuery ST provides, or null when unavailable (host/tests). */
function _getJQuery() {
    try {
        if (typeof window !== 'undefined' && window.jQuery) return window.jQuery;
        if (typeof jQuery !== 'undefined') return jQuery;   // eslint-disable-line no-undef
    } catch (_) { /* no jQuery */ }
    return null;
}

/**
 * PREFERRED activation path — the PROVEN SillyTavern-WorldScope mechanism
 * (activation.js:20-28). Instead of mutating selected_world_info ourselves and
 * hand-rolling persist+emit, we set the #world_info multiselect's VALUE to the
 * indices of the desired active books and trigger('change') so ST's OWN
 * onWorldInfoChange() (world-info.js) rebuilds selected_world_info from the DOM,
 * persists (saveSettingsDebounced), and emits WORLDINFO_SETTINGS_UPDATED.
 *
 * Why this over direct in-place push/splice: #world_info is a select2 widget.
 * A subsequent genuine change event (user opens the WI panel, select2 re-render,
 * another extension) makes ST REBUILD selected_world_info from the DOM's selected
 * options. If we only mutated the array + best-effort option props, that later
 * rebuild could DROP our auto-attached memory book. Going through .val().change()
 * makes select2 itself the source of truth, so the selection survives re-renders.
 *
 * Returns true iff it drove the change handler (the widget was present & ready),
 * false when the DOM/select2 is not available so the caller can fall back.
 *
 * @param {string[]} nextActiveNames  the COMPLETE next active-worlds set.
 * @returns {boolean}
 */
function _applyViaWorldInfoSelect(nextActiveNames) {
    const $ = _getJQuery();
    if (!$ || !Array.isArray(world_names) || world_names.length === 0) return false;
    const $sel = $('#world_info');
    // Require a rendered select with options — without them ST has nothing to
    // rebuild from and .val() would clear the selection. select2 enhances #world_info
    // (world-info.js), so when it isn't rendered yet we must use the fallback.
    if (!$sel.length || $sel.find('option').length === 0) return false;

    // Option VALUES are world_names indices (world-info.js builds
    // `<option value="${i}">`), exactly as WorldScope relies on. Map names->indices.
    const indices = nextActiveNames
        .map((n) => world_names.indexOf(n))
        .filter((i) => i >= 0)
        .map(String);
    $sel.val(indices).trigger('change'); // ST onWorldInfoChange() rebuilds + persists + emits
    return true;
}

/**
 * Phase 4a — LIVE auto-attach of the "<World> - Memories" book to ST's GLOBAL
 * active-worlds set for inference, per-world and additive.
 *
 * Flow:
 *   1. FLAG-OFF SHORT-CIRCUIT — when !isTwoPlane we return immediately BEFORE
 *      touching anything: byte-identical to pre-Phase-4a (zero activation calls).
 *   2. READINESS GATE — bail (no resolve, no create) until world_names is
 *      hydrated. CHAT_CHANGED fires early/repeatedly and world_names is
 *      unreliable before APP_READY (SillyTavern-WorldScope design notes,
 *      worldscope-world-workspace-design.md:230). resolveWorldMemoriesBook()
 *      CREATES a book if world_names lacks it (plane1Context.js), so resolving
 *      too early could create a spurious "<World> - Memories". The caller also
 *      debounces; this gate is the hard floor.
 *   3. Resolve the world book for the current chat (may create+load it).
 *   4. Compute the COMPLETE next active set (computeNextActiveWorlds): preserve
 *      every non-memory book, drop other "* - Memories", add the target.
 *   5. APPLY — PREFER the proven WorldScope DOM-driven path: set #world_info's
 *      value to the next set's indices and trigger('change') so ST's OWN
 *      onWorldInfoChange() rebuilds selected_world_info from the DOM, persists,
 *      and emits. This survives later select2 re-renders (which would otherwise
 *      drop a directly-pushed book). FALL BACK to in-place push/splice +
 *      saveSettingsDebounced + emit ONLY when the #world_info widget is not yet
 *      rendered (chat-open before the WI panel is opened) — headless activation
 *      so retrieval still works before the panel exists.
 *
 * Non-memory books (the user's own chat-bound book via chat_metadata[
 * METADATA_KEY], character/persona lorebooks) are PRESERVED by both paths and
 * never removed — we only ever drop/add names ending in " - Memories" — so this
 * can never clobber a user's own lorebook. ST's getChatLore() separately injects
 * chat_metadata[METADATA_KEY] and skips it if already in selected_world_info, so
 * there is no double-inject either.
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

    // (2) READINESS GATE: world_names not hydrated yet → bail BEFORE resolving so
    // an early CHAT_CHANGED can't create a spurious book or push a name that has
    // no #world_info option (which would make the DOM path silently no-op).
    if (!Array.isArray(world_names) || world_names.length === 0) {
        return NOOP;
    }

    try {
        // (3) Resolve the world book for the current chat (may create+load it).
        const resolved = await resolveWorldMemoriesBook();   // {valid,name,data}|null

        // selected_world_info is a live binding to ST's active array (the full
        // current active set across ALL book kinds).
        const activeAll = Array.isArray(selected_world_info) ? selected_world_info : [];
        const targetName = resolved && resolved.name ? resolved.name : null;

        // (4a) DELTA (memory-book-only) — drives idempotency + logging. If nothing
        // changes among MEMORY books, the full set is unchanged too: no-op.
        const { toActivate, toDeactivate } = computeWorldBookActivation({
            resolvedWorldBook: targetName,
            currentlyActiveMemoryBooks: activeAll.filter(isMemoryBookName),
            isTwoPlane: true,
        });
        if (toActivate.length === 0 && toDeactivate.length === 0) return NOOP;

        // (4b) COMPLETE next active set (for the DOM-driven path, which replaces
        // the whole selection). Preserves every non-memory book by construction.
        const nextActive = computeNextActiveWorlds({
            resolvedWorldBook: targetName,
            currentActive: activeAll,
            isTwoPlane: true,
        });

        // (5) PREFER the proven WorldScope DOM-driven path (select2-safe).
        const droveSelect = _applyViaWorldInfoSelect(nextActive);

        if (!droveSelect) {
            // FALLBACK: #world_info widget not rendered yet — mutate the live
            // array in place + persist + emit, exactly as ST's onWorldInfoChange()
            // does for the /world command. Used at chat-open before the WI panel
            // exists; a subsequent select2 render will reselect from this array.
            for (const name of toDeactivate) {
                const i = selected_world_info.indexOf(name);
                if (i >= 0) selected_world_info.splice(i, 1);
            }
            for (const name of toActivate) {
                if (!selected_world_info.includes(name)) selected_world_info.push(name);
            }
            try { saveSettingsDebounced?.(); } catch (_) { /* non-fatal */ }
            try { eventSource?.emit?.(event_types?.WORLDINFO_SETTINGS_UPDATED); } catch (_) { /* non-fatal */ }
        }

        console.log(
            `STMemoryBooks: two-plane world-book activation (${droveSelect ? 'select2' : 'in-place'}) — +[${toActivate.join(', ')}] -[${toDeactivate.join(', ')}]`,
        );
        return { toActivate, toDeactivate, changed: true };
    } catch (e) {
        console.warn('STMemoryBooks: applyWorldBookActivation failed (non-fatal):', e);
        return NOOP;
    }
}
