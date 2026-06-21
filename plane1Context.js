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
import { chat_metadata, characters, this_chid, name2 } from '../../../../script.js';
import { METADATA_KEY, world_names, loadWorldInfo, createNewWorldInfo } from '../../../world-info.js';
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
