/**
 * plane1Context.js — Impure resolvers for Phase 1a two-plane memory.
 *
 * This file MUST remain separate from plane1.js (which is pure and must
 * load under `node --test` without SillyTavern imports). These functions
 * depend on live SillyTavern globals and cannot be unit-tested in isolation.
 *
 * Exports:
 *   getChatRoster()            → {name, avatar}[]
 *   resolveWorldMemoriesBook() → Promise<{valid:true, name, data}|null>
 */

// Import specifiers copied verbatim from sidePrompts.js lines 1, 3, 5
import { chat_metadata, characters, this_chid, name2 } from '../../../../script.js';
import { METADATA_KEY, world_names, loadWorldInfo, createNewWorldInfo } from '../../../world-info.js';
import { selected_group, groups } from '../../../group-chats.js';

// Local imports
import { deriveWorldPrefix } from './lorebookNameMacros.js';
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
 * Resolve/create/load the shared "<World> - Memories" lorebook.
 * Does NOT rebind chat_metadata[METADATA_KEY] (contrast autoCreateLorebook
 * in autocreate.js which does rebind — we call createNewWorldInfo directly).
 * @returns {Promise<{valid:true, name:string, data:object}|null>}
 */
export async function resolveWorldMemoriesBook() {
    const ctx = getCurrentMemoryBooksContext();
    const world = (ctx?.isGroupChat && ctx.groupName)
        ? ctx.groupName
        : (deriveWorldPrefix(chat_metadata?.[METADATA_KEY]) || ctx?.characterName);
    if (!world) return null;
    const name = `${world} - Memories`;
    if (!(world_names || []).includes(name)) {
        await createNewWorldInfo(name);          // creates the book; does NOT touch chat_metadata
    }
    const data = await loadWorldInfo(name);
    if (!data) return null;
    return { valid: true, name, data };
}
