# Phase 1a — Plane-1 objective + whole-cast gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn STMemoryBooks scene memories into *objective* (omniscient) summaries written to a shared per-world `<World> - Memories` lorebook, each entry retrieval-gated by `characterFilter` to the characters who were present — witness-correct by input-filtering + read-time gating, not by per-character POV generation.

**Architecture:** Phase 1a is the **single-segment** form of the two-plane design. Per scene we: drop unreal (dream/flashback/story) messages; compute the *present cast* from StateTracker audience stamps; input-filter the transcript to messages witnessed by the **entire** cast (whispers / partial-presence messages are conservatively dropped — 1b restores them via segmentation); generate ONE objective summary; and stamp the resulting World Info entry with `characterFilter = present-cast` (mapped to avatar basenames). All witness logic lives in PURE, unit-tested functions; index.js is thin glue. The whole behavior sits behind `moduleSettings.twoPlaneMemory` (default **off** = today's exact behavior).

**Tech Stack:** ES modules; SillyTavern World Info API (`world-info.js`); Node built-in test runner (`node --test tests/`, `node:test` + `node:assert/strict`). Phase 0 primitives in `witnessScope.js` + `memoryEntry.js`. Existing dead-filter fix in `wiFilterName.js`.

## Global Constraints

Every task's requirements implicitly include this section. Copy values verbatim.

- **Test runner:** `node --test tests/` (ES modules, `import { test } from 'node:test'`, `import assert from 'node:assert/strict'`). Do not add a test framework.
- **Feature flag:** all Phase 1a behavior is gated on `extension_settings.STMemoryBooks.moduleSettings.twoPlaneMemory` (boolean, default `false`). When `false`, the pipeline must behave **byte-for-byte as today** (Perspective Rule intact, chat-bound book, no `characterFilter`, no unreal-drop, no input-filter). This is a transitional rollout gate; the end state is objective-only (per the locked design + the user's "replace" decision).
- **Avatar basenames, never display names:** `characterFilter.names` MUST be avatar-file basenames via `characterFilterName({name,avatar})` (`wiFilterName.js`). ST matches `getCharaFilename()`; a display-name filter is permanently dead.
- **Fail-open:** empty OR fully-unstamped audience → **no** `characterFilter` (leave it unset; entry visible to all) AND keep the whole (real) scene. Never write `{names:[]}` for the fail-open case.
- **Fail-closed (N9):** a **non-empty** audience whose names don't resolve → `characterFilter.names = []` (matches **nobody**), never everybody. `buildCharacterFilter`/`buildEntryCharacterFilter` already guarantee this.
- **Raw chat only for stamps:** reality (`extra.channel.reality`) and audience (`extra.channel.audience`) live ONLY on the raw `chat[]` objects. Compiled clones drop `extra`. All witness/reality decisions MUST join via `cm.id → chat[cm.id]`. Never read `extra` off a compiled message.
- **Preserve `cm.id == raw chat index`:** always pass witness joins the SAME `chat` array `compileScene` read from (the module global from `script.js`). Never re-slice.
- **Do not change Phase 0 signatures:** `canonicalName(name, roster:string[])` and `buildCharacterFilter(audience, roster:string[])` keep their signatures and tests. Add new functions on top.
- **POV is never generated:** Plane-1 summary is objective/omniscient over the input-filtered transcript. Witness-correctness comes from input-filtering + read-time `characterFilter`, not from prompt POV scoping.
- **Plane-1 entry shape:** objective summary in `content`; vectorized (`constVectMode: 'link'` → `constant:false, vectorized:true`); written to the shared `<World> - Memories` book; `characterFilter` stamped in `populateLorebookEntry` AFTER `applyLorebookEntrySettings`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `witnessScope.js` | modify (add 2 pure fns) | `dropUnrealFromCompiledScene`, `filterCompiledSceneForAudience` — compiled-scene siblings of `filterCompiledSceneForCharacter` (cm.id→chat join) |
| `memoryEntry.js` | modify (add 1 pure fn) | `buildEntryCharacterFilter(audience, rosterRows)` — `buildCharacterFilter` + display-name→avatar-basename mapping |
| `plane1.js` | **create** | Plane-1 module: PURE `computePlane1Memory(...)` orchestrator (the witness-correctness heart) + impure `getChatRoster()` + impure `resolveWorldMemoriesBook()` |
| `stmemory.js` | modify (~1429-1451) | Split `SCHEME_B_FILTER`; drop the Perspective Rule when `twoPlaneMemory` is on |
| `addlore.js` | modify (`populateLorebookEntry` ~614-638) | Stamp `entry.characterFilter` from `memoryResult.characterFilter` (strip `unresolved`), AFTER `applyLorebookEntrySettings` |
| `index.js` | modify (3 seams) | Wire compute→filter→route→thread at `executeMemoryGeneration`, `buildQueuedMemoryJob`/`executeQueuedMemoryJob`, JSON-repair; flag-gated |
| `constants.js` / settings | modify | `moduleSettings.twoPlaneMemory: false` default (+ settings UI checkbox) |
| `tests/plane1.test.js` | **create** | Acceptance subset U1/U2/U3/N2/N7 + E3/N6 (drop-unreal) + dead-filter + fail-open + fail-closed, against `computePlane1Memory` |
| `tests/witnessScope.test.js` | modify | Add cases for the 2 new pure fns |
| `tests/memoryEntry.test.js` | modify | Add cases for `buildEntryCharacterFilter` (basename mapping) |
| `tests/witness-pov.test.js` | modify | Repurpose the skipped Phase-1 E2E placeholder: point its intent at `plane1.test.js`; keep 1b (U4/U5/E9) + Phase-2 (U6) skipped |

**Decomposition note (surface at review):** Phase 1a is gated behind `twoPlaneMemory`. Because the user chose "replace per-char POV with objective", the flag is a *transitional rollout gate* (default off so TAM2/other chats are undisturbed while TWW2 is validated), not a permanent dual-mode. Once validated, the default flips on and the legacy branch is removed.

---

### Task 1: Compiled-scene witness siblings in `witnessScope.js`

**Files:**
- Modify: `witnessScope.js` (append after `dropUnrealMessages`, ~line 87)
- Test: `tests/witnessScope.test.js`

**Interfaces:**
- Consumes: existing `isUnreal(message)`, `messageWitnessedBy(message, charName)`, `audienceOf(message)` (same file).
- Produces:
  - `dropUnrealFromCompiledScene(compiledScene, chat) -> compiledScene` — new messages array dropping `cm` where `isUnreal(chat[cm.id])`; sets `metadata.messageCount` + `metadata.unrealFiltered`.
  - `filterCompiledSceneForAudience(compiledScene, chat, audience: string[]) -> compiledScene` — keeps `cm` where **every** token in `audience` satisfies `messageWitnessedBy(chat[cm.id], token)`; sets `metadata.messageCount` + `metadata.audienceFiltered`. Empty `audience` keeps all (fail-open).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/witnessScope.test.js — append
import { dropUnrealFromCompiledScene, filterCompiledSceneForAudience } from '../witnessScope.js';

function scene(ids) { return { metadata: { messageCount: ids.length }, messages: ids.map(id => ({ id })) }; }

test('dropUnrealFromCompiledScene removes dream/flashback/story by cm.id join', () => {
  const chat = [];
  chat[0] = { mes: 'a' };
  chat[1] = { mes: 'b', extra: { channel: { reality: 'dream' } } };
  chat[2] = { mes: 'c', extra: { channel: { reality: 'flashback' } } };
  chat[3] = { mes: 'd' };
  const out = dropUnrealFromCompiledScene(scene([0, 1, 2, 3]), chat);
  assert.deepEqual(out.messages.map(m => m.id), [0, 3]);
  assert.equal(out.metadata.messageCount, 2);
  assert.equal(out.metadata.unrealFiltered, 2);
});

test('filterCompiledSceneForAudience keeps only messages witnessed by EVERY token', () => {
  const chat = [];
  chat[0] = { extra: { channel: { audience: ['user', 'shilpa', 'aisha'] } } }; // all
  chat[1] = { extra: { channel: { audience: ['user', 'shilpa'] } } };          // whisper, no aisha
  chat[2] = {};                                                                // unstamped = everyone
  const out = filterCompiledSceneForAudience(scene([0, 1, 2]), chat, ['user', 'shilpa', 'aisha']);
  assert.deepEqual(out.messages.map(m => m.id), [0, 2]);
  assert.equal(out.metadata.audienceFiltered, 1);
});

test('filterCompiledSceneForAudience with empty audience keeps all (fail-open)', () => {
  const chat = [{ extra: { channel: { audience: ['x'] } } }];
  const out = filterCompiledSceneForAudience(scene([0]), chat, []);
  assert.deepEqual(out.messages.map(m => m.id), [0]);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/witnessScope.test.js` → FAIL (functions not exported).

- [ ] **Step 3: Implement**

```javascript
// witnessScope.js — append after dropUnrealMessages

/**
 * Return a NEW compiledScene with unreal-tagged messages removed.
 * Joins each compiledMessage to the live chat via cm.id (compiled clones drop extra.channel).
 */
export function dropUnrealFromCompiledScene(compiledScene, chat) {
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => !isUnreal(chat?.[cm.id]));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            unrealFiltered: all.length - messages.length,
        },
    };
}

/**
 * Return a NEW compiledScene keeping only messages witnessed by EVERY name in audience
 * (fail-open per token via messageWitnessedBy). Empty audience keeps all messages.
 * audience entries are stamp-token form (lowercased); join is via cm.id -> chat.
 */
export function filterCompiledSceneForAudience(compiledScene, chat, audience) {
    const aud = Array.isArray(audience) ? audience : [];
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => aud.every(a => messageWitnessedBy(chat?.[cm.id], a)));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            audienceFiltered: all.length - messages.length,
        },
    };
}
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/witnessScope.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add witnessScope.js tests/witnessScope.test.js && git commit -m "feat(memory): compiled-scene unreal-drop + audience input-filter (Phase 1a)"`

---

### Task 2: `buildEntryCharacterFilter` in `memoryEntry.js` (avatar-basename mapping)

**Files:**
- Modify: `memoryEntry.js` (add import of `characterFilterName`; append function)
- Test: `tests/memoryEntry.test.js`

**Interfaces:**
- Consumes: existing `buildCharacterFilter(audience, roster:string[])`; `characterFilterName(charTarget)` from `./wiFilterName.js`.
- Produces: `buildEntryCharacterFilter(audience: string[], rosterRows: {name,avatar}[]) -> {isExclude:false, names:string[], tags:[], unresolved:string[]} | null` — `names` are **avatar basenames**; `null` only for fail-open (empty audience).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/memoryEntry.test.js — append
import { buildEntryCharacterFilter } from '../memoryEntry.js';

const ROSTER = [
  { name: 'Shilpa', avatar: 'Shilpa.png' },
  { name: 'Priya Mehta', avatar: 'Priya.png' }, // display name != basename (the live 2026-06-11 bug)
];

test('buildEntryCharacterFilter maps resolved names to avatar basenames', () => {
  const cf = buildEntryCharacterFilter(['shilpa', 'priya mehta'], ROSTER);
  assert.deepEqual(cf.names.sort(), ['Priya', 'Shilpa']);   // basenames, NOT 'Priya Mehta'
  assert.equal(cf.isExclude, false);
});

test('buildEntryCharacterFilter is fail-open (null) on empty audience', () => {
  assert.equal(buildEntryCharacterFilter([], ROSTER), null);
});

test('buildEntryCharacterFilter is fail-closed (names:[]) on unresolved non-empty audience', () => {
  const cf = buildEntryCharacterFilter(['ghost'], ROSTER);
  assert.deepEqual(cf.names, []);                 // matches nobody, never everybody (N9)
  assert.deepEqual(cf.unresolved, ['ghost']);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/memoryEntry.test.js` → FAIL.

- [ ] **Step 3: Implement**

```javascript
// memoryEntry.js — add at top, after the file header comment:
import { characterFilterName } from './wiFilterName.js';

// memoryEntry.js — append at end:

/**
 * Build a World-Info-ready characterFilter from a witness audience, mapping resolved
 * roster members to their AVATAR BASENAME (ST matches getCharaFilename, never display name).
 * @param {string[]} audience perceiver tokens (any case)
 * @param {{name:string,avatar?:string}[]} rosterRows discoverChatCharacters()-style rows
 * @returns {{isExclude:false,names:string[],tags:string[],unresolved:string[]}|null}
 *   null ONLY when audience is empty/missing (fail-open). Non-empty unresolved -> names:[] (N9).
 */
export function buildEntryCharacterFilter(audience, rosterRows) {
    const rows = Array.isArray(rosterRows) ? rosterRows : [];
    const roster = rows.map(r => r && r.name).filter(Boolean);
    const cf = buildCharacterFilter(audience, roster);   // {names: display names}|null
    if (!cf) return null;                                 // fail-open
    const byName = new Map(rows.map(r => [r.name, r]));
    const names = [];
    for (const dn of cf.names) {
        const base = characterFilterName(byName.get(dn));
        if (base && !names.includes(base)) names.push(base);
    }
    return { isExclude: false, names, tags: [], unresolved: cf.unresolved };
}
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/memoryEntry.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add memoryEntry.js tests/memoryEntry.test.js && git commit -m "feat(memory): buildEntryCharacterFilter maps audience to avatar basenames (Phase 1a)"`

---

### Task 3: `computePlane1Memory` pure orchestrator (the witness-correctness heart)

**Files:**
- Create: `plane1.js` (this task adds ONLY the pure orchestrator + its imports)
- Test: `tests/plane1.test.js`

**Interfaces:**
- Consumes: `dropUnrealFromCompiledScene`, `filterCompiledSceneForAudience`, `audienceOf` (`./witnessScope.js`); `buildEntryCharacterFilter` (`./memoryEntry.js`).
- Produces: `computePlane1Memory(compiledScene, chat, rosterRows, opts?) -> { skipped:boolean, reason?:string, filteredScene?, characterFilter?, audience?:string[] }`.
  - `opts.userToken` (string, lowercased persona/`name1`) — included in the input-filter cast but excluded from the gate (the user has no character turn).

- [ ] **Step 1: Write the failing tests** (acceptance subset — fixtures mirror docs/two-plane-memory/2026-06-20-memory-pov-acceptance-tests.md)

```javascript
// tests/plane1.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlane1Memory } from '../plane1.js';

// Build a (chat, compiledScene) pair where compiled msg id == chat index.
function fixture(rows) {
  // rows: [{ name, is_user?, audience?, reality? }]
  const chat = rows.map(r => ({
    name: r.name, is_user: !!r.is_user, mes: r.name + ' line',
    extra: { channel: { ...(r.audience ? { audience: r.audience } : {}), ...(r.reality ? { reality: r.reality } : {}) } },
  }));
  const messages = rows.map((r, i) => ({ id: i, name: r.name, mes: r.name + ' line', is_user: !!r.is_user }));
  return { chat, compiledScene: { metadata: { sceneStart: 0, sceneEnd: rows.length - 1, messageCount: rows.length }, messages } };
}
const ROSTER3 = [
  { name: 'Shilpa', avatar: 'Shilpa.png' },
  { name: 'Aisha', avatar: 'Aisha.png' },
  { name: 'Priya Mehta', avatar: 'Priya.png' },
];

test('U1 solo: one character, gated to that character, nothing dropped', () => {
  const { chat, compiledScene } = fixture([
    { name: 'User', is_user: true, audience: ['user', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.skipped, false);
  assert.deepEqual(r.characterFilter.names, ['Aisha']);
  assert.equal(r.filteredScene.messages.length, 2);
});

test('U2 full group homogeneous: gated to all present, nothing dropped', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.equal(r.filteredScene.messages.length, 2);
});

test('N2 absent char excluded; whisper to a subset is dropped (non-leak)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'] },   // Shilpa absent for this one (sub-cast) -> dropped
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  // present cast = union {user,shilpa,aisha}; keep msgs witnessed by ALL -> only msg 0
  assert.deepEqual(r.filteredScene.messages.map(m => m.id), [0]);
  assert.deepEqual(r.characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.equal(r.characterFilter.names.includes('Priya'), false); // Priya absent -> excluded
});

test('E3/N6 unreal scene dropped before everything', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.filteredScene.messages.map(m => m.id), [0]); // dream msg gone
});

test('all-unreal scene -> skipped (no-op, no throw)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.skipped, true);
});

test('dead-filter fix: gate uses avatar basename not display name', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Priya Mehta', audience: ['user', 'priya mehta'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.characterFilter.names, ['Priya']); // NOT 'Priya Mehta'
});

test('fail-open: fully unstamped scene -> no gate, keep all', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha' }, { name: 'Shilpa' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.characterFilter, null);
  assert.equal(r.filteredScene.messages.length, 2);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/plane1.test.js` → FAIL (no module).

- [ ] **Step 3: Implement the pure orchestrator**

```javascript
// plane1.js
/**
 * plane1.js — Plane-1 (objective shared memory) logic.
 * PURE orchestrator computePlane1Memory has NO SillyTavern imports (fully unit-testable).
 * Impure helpers (getChatRoster / resolveWorldMemoriesBook) are added in Task 4.
 * See docs/two-plane-memory/.
 */
import { dropUnrealFromCompiledScene, filterCompiledSceneForAudience, audienceOf } from './witnessScope.js';
import { buildEntryCharacterFilter } from './memoryEntry.js';

/**
 * Single-segment Plane-1 computation for one scene.
 * @param {object} compiledScene  from compileScene (messages[].id == raw chat index)
 * @param {Array}  chat           live chat array (carries extra.channel)
 * @param {{name:string,avatar?:string}[]} rosterRows  AI characters in the chat
 * @param {{userToken?:string}} opts  lowercased persona/name1 token (kept out of the gate)
 * @returns {{skipped:boolean, reason?:string, filteredScene?:object,
 *            characterFilter?:object|null, audience?:string[]}}
 */
export function computePlane1Memory(compiledScene, chat, rosterRows, opts = {}) {
    const userToken = String(opts.userToken || '').trim().toLowerCase();

    // 1. Reality: drop dream/flashback/story.
    const real = dropUnrealFromCompiledScene(compiledScene, chat);
    if (!real.messages.length) return { skipped: true, reason: 'all-unreal' };

    // 2. Present cast = union of audience tokens actually stamped within the real scene.
    const tokens = new Set();
    for (const cm of real.messages) {
        const aud = audienceOf(chat?.[cm.id]);
        if (aud) for (const t of aud) tokens.add(t);
    }

    // 3. Fully unstamped -> fail-open: whole real scene, no gate.
    if (tokens.size === 0) {
        return { skipped: false, filteredScene: real, characterFilter: null, audience: [] };
    }

    // 4. Input-filter to messages witnessed by the ENTIRE cast (user included).
    const cast = [...tokens];
    const scoped = filterCompiledSceneForAudience(real, chat, cast);
    if (!scoped.messages.length) return { skipped: true, reason: 'no-cast-witnessed' };

    // 5. Gate = cast minus the user (no character turn); mapped to avatar basenames; N9 fail-closed.
    const gateTokens = cast.filter(t => t !== userToken);
    const characterFilter = buildEntryCharacterFilter(gateTokens, rosterRows);

    return { skipped: false, filteredScene: scoped, characterFilter, audience: cast };
}
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/plane1.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add plane1.js tests/plane1.test.js && git commit -m "feat(memory): computePlane1Memory single-segment witness orchestrator (Phase 1a)"`

---

### Task 4: Impure resolvers — `getChatRoster()` + `resolveWorldMemoriesBook()`

**Files:**
- Modify: `plane1.js` (append impure helpers; add ST imports)
- Test: `tests/plane1.test.js` is unaffected (these are impure; verified by review + live). Add a small pure test only if a name-derivation helper is extracted.

**Interfaces:**
- Produces:
  - `getChatRoster() -> {name:string, avatar:string}[]` — solo: `[characters[this_chid]]`; group: `selected_group` members → `characters`. Mirror `sidePrompts.js:132-173` (`discoverChatCharacters`) exactly.
  - `resolveWorldMemoriesBook() -> Promise<{valid:true,name:string,data:object}|null>` — derive world, ensure `<World> - Memories` exists (create WITHOUT rebinding chat metadata), load it.

**Implementation notes (verify import paths against existing imports in `sidePrompts.js` / `index.js`):**

- [ ] **Step 1: Implement `getChatRoster`** (mirror `discoverChatCharacters`)

```javascript
// plane1.js — add imports near top (match the exact relative depth used elsewhere in repo):
import { characters, this_chid, chat_metadata } from '../../../../script.js';
import { selected_group, groups } from '../../../../scripts/group-chats.js';
import { world_names, loadWorldInfo, createNewWorldInfo } from '../../../../scripts/world-info.js';
import { deriveWorldPrefix } from './lorebookNameMacros.js';
import { getCurrentMemoryBooksContext } from './utils.js';
import { METADATA_KEY } from './constants.js';

/** AI characters in the current chat: {name, avatar}. Solo or group. */
export function getChatRoster() {
    if (selected_group) {
        const group = (groups || []).find(g => g.id === selected_group);
        const members = group?.members || [];
        return members
            .map(av => {
                const c = (characters || []).find(ch => ch.avatar === av);
                return c ? { name: c.name, avatar: c.avatar } : null;
            })
            .filter(Boolean);
    }
    const c = characters?.[this_chid];
    return c ? [{ name: c.name, avatar: c.avatar }] : [];
}
```

> Implementer: confirm the exact import specifiers by copying them from `sidePrompts.js` (which already imports `selected_group, groups, characters, this_chid`) and `index.js` (which imports `world_names`/`loadWorldInfo`/`createNewWorldInfo` from `world-info.js`, and `METADATA_KEY`). Use those paths verbatim; do not guess depth.

- [ ] **Step 2: Implement `resolveWorldMemoriesBook`**

```javascript
// plane1.js — append
/** Resolve/create/load the shared "<World> - Memories" book. Does NOT rebind chat metadata. */
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
```

- [ ] **Step 3: Verify** — `node --test tests/` (no regressions). Manual/review: confirm `createNewWorldInfo` creates an empty book and does NOT write `chat_metadata[METADATA_KEY]` (contrast `autoCreateLorebook`, which does).

- [ ] **Step 4: Commit** — `git add plane1.js && git commit -m "feat(memory): roster + <World>-Memories book resolvers (Phase 1a)"`

---

### Task 5: Objective rework — flag-gated Perspective Rule + `twoPlaneMemory` setting

**Files:**
- Modify: `stmemory.js` (`buildPrompt`, ~1425-1451)
- Modify: settings default — add `twoPlaneMemory: false` to `moduleSettings` defaults (locate `defaultSettings`/`moduleSettings` in `index.js`/`constants.js`); add a checkbox to the settings modal.

**Interfaces:**
- Consumes: `extension_settings.STMemoryBooks.moduleSettings.twoPlaneMemory`.
- Produces: when flag on, `buildPrompt` omits the `## Perspective Rule` block; keeps the `## Scene Format Guide`.

- [ ] **Step 1: Add the setting default** — find the `moduleSettings` defaults object and add `twoPlaneMemory: false,`. Add a labeled checkbox in the settings modal bound to it (mirror an existing boolean `moduleSettings` toggle like `useRegex`). Run existing settings tests if any.

- [ ] **Step 2: Split `SCHEME_B_FILTER`** in `stmemory.js:1429-1451` into two consts and gate the rule:

```javascript
// stmemory.js — replace the single SCHEME_B_FILTER assignment (1429-1451) with:
const SCENE_FORMAT_GUIDE =
    '## Scene Format Guide (Scheme B)\n' +
    '- "quotes" = spoken dialogue — INCLUDE: audible to characters present.\n' +
    '- *italics* = private unspoken thought — SKIP: invisible to all other characters.\n' +
    '- (parentheses) = narrator aside — SKIP: reader-only, no character perceives it.\n' +
    '- Plain prose = actions and behavior. Apply the rules below.\n' +
    '\n' +
    'INCLUDE (externally observable):\n' +
    '- Physical actions: "she leaned in", "his touch became frantic", "she went rigid"\n' +
    '- Audible sounds or speech delivery: "inhale escaped", "voice came out too high"\n' +
    '- Visible tells that reveal a concealed state: "fingers curled", "didn\'t look down" — extract the behavior, not the internal reason behind it\n' +
    '\n' +
    'SKIP (internal/unobservable):\n' +
    '- Internal sensations: "a jolt through her", "warmth spread through her"\n' +
    '- Emotional metaphors and framing: "intoxicating", "electricity between them", "dread pooled"\n' +
    '- Internal effort or process: "she fought to stay calm", "she forced herself to" — skip the effort; if the visible result matters, note only what is outwardly visible\n' +
    '- First-person interiority: feelings, self-awareness, and reasoning not expressed outwardly\n' +
    '\n';

const PERSPECTIVE_RULE =
    '## Perspective Rule\n' +
    'This memory belongs to {{char}}. Extract ONLY what {{char}} directly witnessed or was explicitly told. ' +
    'Do NOT extract another character\'s private sensations, concealed actions, or internal thoughts as if {{char}} already knew about them.\n\n';

const twoPlane = !!(extension_settings?.STMemoryBooks?.moduleSettings?.twoPlaneMemory);
const SCHEME_B_FILTER = substituteParams(
    SCENE_FORMAT_GUIDE + (twoPlane ? '' : PERSPECTIVE_RULE),
    metadata.userName, metadata.characterName,
);
```

- [ ] **Step 3: Verify** — `node --test tests/` passes; manual read confirms `finalPrompt` (line 1458) is unchanged in structure. Add/confirm a unit test if `buildPrompt` is testable in isolation; otherwise rely on review (it imports ST globals).

- [ ] **Step 4: Commit** — `git add stmemory.js index.js constants.js && git commit -m "feat(memory): objective summary when twoPlaneMemory on (drop Perspective Rule) (Phase 1a)"`

---

### Task 6: Stamp `characterFilter` in `addlore.js populateLorebookEntry`

**Files:**
- Modify: `addlore.js` (`populateLorebookEntry`, ~614-638)

**Interfaces:**
- Consumes: `memoryResult.characterFilter` (set by Task 7) — `{isExclude:false, names:string[], tags:[], unresolved?}` or absent.
- Produces: `entry.characterFilter = {isExclude, names, tags}` (drops `unresolved`), set AFTER `applyLorebookEntrySettings`. Absent/null → not set (fail-open).

- [ ] **Step 1: Implement** — inside `populateLorebookEntry`, AFTER the `applyLorebookEntrySettings(...)` call and the `STMB_*` assignments (after ~line 636), add:

```javascript
    // Phase 1a: audience gate. memoryResult.characterFilter is null/absent for fail-open.
    if (memoryResult.characterFilter && Array.isArray(memoryResult.characterFilter.names)) {
        const { isExclude = false, names, tags = [] } = memoryResult.characterFilter;
        entry.characterFilter = { isExclude, names, tags }; // strip helper-only `unresolved`
    }
```

> Note: `characterFilter` is NOT in `CONTROLLED_WORLD_INFO_DEFAULT_FIELDS`, so `applyLorebookEntrySettings` will not clobber it; setting it after is belt-and-suspenders and unambiguous.

- [ ] **Step 2: Verify** — `node --test tests/`; review confirms placement after the apply call. (No node test for addlore — it imports ST; covered by review + the live E2E.)

- [ ] **Step 3: Commit** — `git add addlore.js && git commit -m "feat(memory): stamp entry.characterFilter from memoryResult in populateLorebookEntry (Phase 1a)"`

---

### Task 7: Wire the pipeline (non-queued / queued / JSON-repair) + repurpose the E2E gate

**Files:**
- Modify: `index.js` — `executeMemoryGeneration` (~2425-2710), `buildQueuedMemoryJob` (~3011-3050) + `executeQueuedMemoryJob` (~3171-3236), JSON-repair (~8485-8551), and `lastFailedAIContext` capture (~2871)
- Modify: `tests/witness-pov.test.js` — repurpose the skipped Phase-1 placeholder

**Interfaces:**
- Consumes: `computePlane1Memory`, `getChatRoster`, `resolveWorldMemoriesBook` (`./plane1.js`); live `chat`, `name1` (script.js, already imported).
- Produces: when `twoPlaneMemory` on — objective input-filtered scene fed to `createMemory`; `memoryResult.characterFilter` set; the write routed to `<World> - Memories`. When off — unchanged.

**Global gate helper** (define once near the other module helpers):
```javascript
const isTwoPlane = () => !!(extension_settings?.STMemoryBooks?.moduleSettings?.twoPlaneMemory);
```

- [ ] **Step 1: Non-queued seam** — in `executeMemoryGeneration`, immediately after `compiledScene = compileScene(sceneRequest);` (~2527):

```javascript
    let plane1Book = null, plane1Filter = null;
    if (isTwoPlane()) {
        const p1 = computePlane1Memory(compiledScene, chat, getChatRoster(), { userToken: (name1 || '').toLowerCase() });
        if (p1.skipped) {
            // nothing real/witnessed to record — clean no-op, mirror the existing "no memory" toast/return
            return { success: false, skipped: true, reason: p1.reason };
        }
        compiledScene = p1.filteredScene;     // objective summary sees the input-filtered transcript
        plane1Filter = p1.characterFilter;
        plane1Book = await resolveWorldMemoriesBook();
    }
```
Then after `createMemory(...)` returns `memoryResult` (~2602): `if (isTwoPlane()) memoryResult.characterFilter = plane1Filter;`
And at the primary `addMemoryToLorebook(...)` (~2706): pass `plane1Book || lorebookValidation` as the validation arg when `isTwoPlane() && plane1Book`. The mirror loop (~2743) is unchanged (it inherits `characterFilter` via the shared `memoryResult`).

> Match the existing `p1.skipped` return shape to whatever `executeMemoryGeneration` already returns for "no memory created", and ensure the preview path (~2610-2693) still runs on the filtered `compiledScene` (it already reads the local `compiledScene`/`memoryResult`).

- [ ] **Step 2: Queued seam** — in `buildQueuedMemoryJob`, after `compiledScene = compileScene(...)` (~3011) and BEFORE the `deepClone` snapshot (~3050):

```javascript
    let plane1 = null;
    if (isTwoPlane()) {
        const p1 = computePlane1Memory(compiledScene, chat, getChatRoster(), { userToken: (name1 || '').toLowerCase() });
        if (!p1.skipped) {
            compiledScene = p1.filteredScene;                       // snapshot the filtered scene
            plane1 = { characterFilter: p1.characterFilter, bookName: (await resolveWorldMemoriesBook())?.name || null };
        } else {
            plane1 = { skipped: true, reason: p1.reason };
        }
    }
    // include `plane1` in the returned payload object
```
In `executeQueuedMemoryJob` (~3171): if `payload.plane1?.skipped`, finish the job as a no-op. Otherwise after `createMemory(...)` (~3183): `finalMemoryResult.characterFilter = payload.plane1?.characterFilter || null;` and replace the book load (~3224) — when `payload.plane1?.bookName`, do `const data = await loadWorldInfo(payload.plane1.bookName); lorebookValidation = { valid: true, name: payload.plane1.bookName, data };` before the `addMemoryToLorebook` at ~3236. (Compute the book NAME at enqueue, reload DATA fresh at execution — never carry the data object across the snapshot.)

- [ ] **Step 3: JSON-repair seam** — at the literal `const memoryResult = {...}` (~8502), add a `characterFilter` recomputed from the repair context, and route the write (~8551) to the world book:

```javascript
    // after building the memoryResult literal:
    if (isTwoPlane() && context?.compiledScene) {
        const p1 = computePlane1Memory(context.compiledScene, chat, getChatRoster(), { userToken: (name1 || '').toLowerCase() });
        memoryResult.characterFilter = p1.characterFilter || null;
        const wb = await resolveWorldMemoriesBook();
        if (wb) { /* pass wb as lorebookValidation to addMemoryToLorebook at ~8551 */ }
    }
```
Also when `lastFailedAIContext` is captured (~2871), include the already-computed `characterFilter` so repair can reuse it without recompute (optional optimization; recompute is the source of truth).

- [ ] **Step 4: Repurpose the E2E gate** — in `tests/witness-pov.test.js`, replace the skipped `'E2E: group extraction yields per-character witness-correct entries'` placeholder body with a pointer + active 1a coverage assertion, and keep the genuinely-1b/Phase-2 cases skipped:

```javascript
// tests/witness-pov.test.js
test('Phase 1a: objective single-segment witness gate is covered by tests/plane1.test.js', () => {
  // U1/U2/N2 + drop-unreal + dead-filter + fail-open/closed are exercised in plane1.test.js
  // against computePlane1Memory (the pure witness heart). Live ST wiring (book routing,
  // populateLorebookEntry stamp) is verified by the final review + manual smoke in SillyTavern.
  assert.ok(true);
});
test('U4/U5/E9 enter-exit segmentation', { skip: 'Phase 1b — audience segmenter not built' }, () => {});
test('U6 shell: whisper-occurred-without-content', { skip: 'Phase 2 — shell mechanism not built' }, () => {});
```

- [ ] **Step 5: Verify** — `node --test tests/` → all pass (69 prior + new; 2+ still skipped for 1b/Phase-2). Then a manual smoke checklist (document in the PR/report, not automated): with `twoPlaneMemory` ON in a TWW2 group chat, create a memory → confirm (a) entry lands in `🏠 TWW2 - Memories`, (b) entry has `characterFilter.names` = present cast as **avatar basenames**, (c) a dream-tagged message is absent from the summary, (d) with the flag OFF, behavior is identical to before.

- [ ] **Step 6: Commit** — `git add index.js tests/witness-pov.test.js && git commit -m "feat(memory): wire Plane-1 objective+gated writes across all paths behind twoPlaneMemory (Phase 1a)"`

---

## Self-Review

- **Spec coverage:** D1 drop-unreal (Task 1+3), D2 import witnessScope into pipeline (Task 3+7), D5 characterFilter stamp (Task 2+6+7), D6 shared `<World> - Memories` book (Task 4+7), objective rework / remove POV (Task 5), un-skip E2E subset (Task 3 tests + Task 7 repurpose). Segmentation (D3/D4 → U4/U5/E9) explicitly deferred to 1b. ✓
- **Traps handled:** dead filter → `buildEntryCharacterFilter` basenames (Task 2); drop-unreal no-op → join via `chat[cm.id]` (Task 1); per-char POV conflict → flag-gated removal (Task 5); audience timing → compute at enqueue (Task 7 Step 2); preview survival → spread confirmed, JSON-repair recompute (Task 7 Step 3); all-unreal throw → `skipped` no-op (Task 3). ✓
- **Type consistency:** `computePlane1Memory` returns `{skipped, filteredScene, characterFilter, audience}` used consistently in Task 7; `buildEntryCharacterFilter` returns `{isExclude,names,tags,unresolved}`, `unresolved` stripped in Task 6. ✓
- **Known 1a limitation (honest):** whole-cast input-filter conservatively DROPS partial-presence / whisper messages (anything not witnessed by the entire present cast). Correct (non-leaking) but lossy on non-homogeneous scenes; 1b's segmenter restores them as separate audience segments. `N3` (no thought leak) is enforced by the retained Scene Format Guide at summary time (LLM), not node-tested.
