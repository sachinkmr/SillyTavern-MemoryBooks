import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    hasLorebookNameMacros, resolveLorebookNameMacros, resolveLorebookNameList,
    deriveWorldPrefix, pickFolderName,
} from '../lorebookNameMacros.js';

test('{{group}} resolves to the group chat NAME (emoji preserved), not a member list', () => {
    assert.equal(
        resolveLorebookNameMacros('{{group}} - Actors', { groupName: '🏠 TWW2', charName: 'Aisha' }),
        '🏠 TWW2 - Actors',
    );
});

test('{{group}} falls back to the character name in a solo (non-group) chat', () => {
    assert.equal(
        resolveLorebookNameMacros('{{group}} - Actors', { groupName: null, charName: 'Ira Saxena' }),
        'Ira Saxena - Actors',
    );
    assert.equal(
        resolveLorebookNameMacros('{{group}} - Actors', { charName: 'Ira Saxena' }),
        'Ira Saxena - Actors',
    );
});

test('{{char}} resolves to the provided character/actor name', () => {
    assert.equal(
        resolveLorebookNameMacros('🏠 TWW2 - {{char}}', { groupName: '🏠 TWW2', charName: 'Kavya Nair' }),
        '🏠 TWW2 - Kavya Nair',
    );
});

test('names without macros pass through unchanged', () => {
    assert.equal(
        resolveLorebookNameMacros('Alaris Lorebook', { groupName: '🏠 TWW2', charName: 'Aisha' }),
        'Alaris Lorebook',
    );
    assert.equal(resolveLorebookNameMacros('Alaris Lorebook', {}), 'Alaris Lorebook');
});

test('unresolvable macros are left intact so existence-validation fails downstream (missing-book fallback)', () => {
    // No group AND no char context: tokens stay literal — they will not match any
    // world_names entry, which triggers the caller’s warn + default-routing fallback.
    assert.equal(resolveLorebookNameMacros('{{group}} - Actors', {}), '{{group}} - Actors');
    assert.equal(resolveLorebookNameMacros('Book of {{char}}', { groupName: '🏠 TWW2' }), 'Book of {{char}}');
});

test('macro tokens are case-insensitive and tolerate inner whitespace', () => {
    assert.equal(
        resolveLorebookNameMacros('{{ Group }} - Actors ({{ CHAR }})', { groupName: '🏠 TAM2', charName: 'Naina' }),
        '🏠 TAM2 - Actors (Naina)',
    );
});

test('hasLorebookNameMacros detects {{group}}/{{char}} only', () => {
    assert.equal(hasLorebookNameMacros('{{group}} - Actors'), true);
    assert.equal(hasLorebookNameMacros('🏠 TWW2 - {{char}}'), true);
    assert.equal(hasLorebookNameMacros('{{ GROUP }}'), true);
    assert.equal(hasLorebookNameMacros('Alaris Lorebook'), false);
    assert.equal(hasLorebookNameMacros('{{user}} journal'), false);
    assert.equal(hasLorebookNameMacros(null), false);
});

test('resolveLorebookNameList resolves, trims, dedupes post-resolution, and skips non-strings', () => {
    const ctx = { groupName: '🏠 TWW2', charName: 'Meera' };
    assert.deepEqual(
        resolveLorebookNameList(['{{group}} - Actors', ' 🏠 TWW2 - Actors ', 42, '', null, 'Other Book'], ctx),
        ['🏠 TWW2 - Actors', 'Other Book'],
    );
    assert.deepEqual(resolveLorebookNameList(undefined, ctx), []);
    assert.deepEqual(resolveLorebookNameList('not-an-array', ctx), []);
});

test('group name takes priority over char name for {{group}} when both exist', () => {
    assert.equal(
        resolveLorebookNameMacros('{{group}} - Actors', { groupName: '🏠 TWW2', charName: 'Shilpa' }),
        '🏠 TWW2 - Actors',
    );
});

// ---------------------------------------------------------------------------
// Option A — solo {{group}} = world prefix derived from the chat-bound lorebook.
// deriveWorldPrefix('<prefix> - Core' | '<prefix> - Memories') → '<prefix>';
// anything else (suffix mid-string, other suffixes, empty) → null.
// ---------------------------------------------------------------------------

test('deriveWorldPrefix: "… - Core" yields the world prefix (emoji preserved)', () => {
    assert.equal(deriveWorldPrefix('🏠 TWW2 - Core'), '🏠 TWW2');
});

test('deriveWorldPrefix: "… - Memories" yields the world prefix', () => {
    assert.equal(deriveWorldPrefix('🏠 TWW2 - Memories'), '🏠 TWW2');
});

test('deriveWorldPrefix: plain name without a recognized suffix => null', () => {
    assert.equal(deriveWorldPrefix('Alaris Lorebook'), null);
});

test('deriveWorldPrefix: null/undefined/empty => null', () => {
    assert.equal(deriveWorldPrefix(null), null);
    assert.equal(deriveWorldPrefix(undefined), null);
    assert.equal(deriveWorldPrefix(''), null);
});

test('deriveWorldPrefix: " - Core" mid-string does NOT derive (suffix only)', () => {
    assert.equal(deriveWorldPrefix('X - Core - Y'), null);
});

test('deriveWorldPrefix: character books like "🏠 TWW2 - Shilpa" => null (only Core/Memories derive)', () => {
    assert.equal(deriveWorldPrefix('🏠 TWW2 - Shilpa'), null);
    assert.equal(deriveWorldPrefix('🏠 TWW2 - Actors'), null);
});

test('deriveWorldPrefix: multi-dash prefixes keep everything before the suffix', () => {
    assert.equal(deriveWorldPrefix('A - B - Core'), 'A - B');
    assert.equal(deriveWorldPrefix('A - B - Memories'), 'A - B');
});

test('deriveWorldPrefix: bare suffix with no prefix => null', () => {
    assert.equal(deriveWorldPrefix(' - Core'), null);
    assert.equal(deriveWorldPrefix(' - Memories'), null);
});

// ---------------------------------------------------------------------------
// pickFolderName — pure helper for tag-folder world derivation
// ---------------------------------------------------------------------------

const FOLDER_TAG_ID   = 'tag-folder-1';
const NONFOLDER_TAG_ID = 'tag-plain-1';

const TAG_LIST_BASIC = [
    { id: NONFOLDER_TAG_ID, name: 'Romance',    folder_type: 'NONE'   },
    { id: FOLDER_TAG_ID,    name: '🏠 TWW2',    folder_type: 'OPEN'   },
];
const TAG_MAP_BASIC = { 'char-avatar.png': [NONFOLDER_TAG_ID, FOLDER_TAG_ID] };

test('pickFolderName: entity with a folder tag returns the tag name', () => {
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, TAG_LIST_BASIC), '🏠 TWW2');
});

test('pickFolderName: entity with only non-folder tags returns null', () => {
    const tagMap = { 'char-avatar.png': [NONFOLDER_TAG_ID] };
    assert.equal(pickFolderName('char-avatar.png', tagMap, TAG_LIST_BASIC), null);
});

test('pickFolderName: multiple folder tags — first match by tagList order wins', () => {
    const folderTag2 = { id: 'tag-folder-2', name: 'Other Folder', folder_type: 'CLOSED' };
    const tagList = [
        { id: NONFOLDER_TAG_ID, name: 'Romance',      folder_type: 'NONE'   },
        { id: FOLDER_TAG_ID,    name: '🏠 TWW2',      folder_type: 'OPEN'   },
        folderTag2,
    ];
    const tagMap = { 'char-avatar.png': [FOLDER_TAG_ID, 'tag-folder-2', NONFOLDER_TAG_ID] };
    // tagList order: FOLDER_TAG_ID comes before tag-folder-2 → '🏠 TWW2' wins
    assert.equal(pickFolderName('char-avatar.png', tagMap, tagList), '🏠 TWW2');
});

test('pickFolderName: missing entityKey returns null', () => {
    assert.equal(pickFolderName(null,      TAG_MAP_BASIC, TAG_LIST_BASIC), null);
    assert.equal(pickFolderName(undefined, TAG_MAP_BASIC, TAG_LIST_BASIC), null);
    assert.equal(pickFolderName('',        TAG_MAP_BASIC, TAG_LIST_BASIC), null);
});

test('pickFolderName: missing/null tagMap returns null', () => {
    assert.equal(pickFolderName('char-avatar.png', null,      TAG_LIST_BASIC), null);
    assert.equal(pickFolderName('char-avatar.png', undefined, TAG_LIST_BASIC), null);
});

test('pickFolderName: non-array tagList returns null', () => {
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, null),      null);
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, undefined),  null);
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, {}),         null);
});

test('pickFolderName: entityKey not in tagMap returns null (empty ids)', () => {
    assert.equal(pickFolderName('unknown-entity', TAG_MAP_BASIC, TAG_LIST_BASIC), null);
});

test('pickFolderName: folder_type NONE is excluded', () => {
    const tagList = [{ id: 'tag-x', name: 'FolderLike', folder_type: 'NONE' }];
    const tagMap  = { 'char-avatar.png': ['tag-x'] };
    assert.equal(pickFolderName('char-avatar.png', tagMap, tagList), null);
});

test('pickFolderName: folder_type OPEN is matched (case-insensitive)', () => {
    const tagList = [{ id: 'tag-x', name: 'My World', folder_type: 'open' }];
    const tagMap  = { 'char-avatar.png': ['tag-x'] };
    assert.equal(pickFolderName('char-avatar.png', tagMap, tagList), 'My World');
});

test('pickFolderName: folder_type CLOSED is matched', () => {
    const tagList = [{ id: 'tag-x', name: 'Secret World', folder_type: 'CLOSED' }];
    const tagMap  = { 'char-avatar.png': ['tag-x'] };
    assert.equal(pickFolderName('char-avatar.png', tagMap, tagList), 'Secret World');
});

test('pickFolderName: null or non-string tag entry in tagList is skipped defensively', () => {
    const tagList = [null, undefined, { id: FOLDER_TAG_ID, name: '🏠 TWW2', folder_type: 'OPEN' }];
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, tagList), '🏠 TWW2');
});

test('pickFolderName: folder tag with blank name returns null', () => {
    const tagList = [{ id: FOLDER_TAG_ID, name: '   ', folder_type: 'OPEN' }];
    assert.equal(pickFolderName('char-avatar.png', TAG_MAP_BASIC, tagList), null);
});

test('pickFolderName: works with group id as entityKey (group chat path)', () => {
    const tagMap = { 'group-99': [FOLDER_TAG_ID] };
    assert.equal(pickFolderName('group-99', tagMap, TAG_LIST_BASIC), '🏠 TWW2');
});
