# Epistemic Deep-Save (Plane-2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the per-character Epistemic tracker a lossless, bounded knowledge store — a hot entry of active beliefs plus an ST-native vectorized cold "Deep Facts" book that STMB curates on eviction.

**Architecture:** HYBRID. The Epistemic side-prompt emits an explicit `## To Deep Storage` eviction list each run. A new PURE module `plane2.js` parses it and builds witness-gated cold lorebook entries; a thin DI orchestrator (`writeDeepFacts`, also in `plane2.js`) is called from all three side-prompt completion paths to upsert those entries into `🏠 TWW2 - Deep Facts`. Retrieval is ST's native vector WI (free, characterFilter-gated) — no read-side code.

**Tech Stack:** Vanilla ES modules; `node --test` + `node:assert/strict`; ST world-info API (`loadWorldInfo` / `saveWorldInfo` / `upsertLorebookEntryByTitle`); `bun run build.ts` (pre-commit hook minifies `index.js` → `index.build.js`).

## Global Constraints

- **Branch:** `two-plane-memory` (STMB repo). No push/merge unless asked.
- **Pure modules import NO SillyTavern code.** `plane2.js` may import only `./memoryEntry.js` (as `shell.js`/`plane1.js` do); all ST impurity is injected via `deps`.
- **Tests:** `node --test tests/<file>` — `import { test } from 'node:test'; import assert from 'node:assert/strict';`. Baseline is **190 pass / 0 fail**; never regress it.
- **Prompt/template changes are doc-first:** every edit to `data/default-user/user/files/stmb-side-prompts.json` gets a diff-doc, a backup (`<file>.bak-<date>-<tag>`), a python apply with `count==1` asserts, and a structural diff proving only the intended fields changed. The file is the LIVE store (`constants.js:43` `SIDE_PROMPTS_FILE`; fetched at `sidePromptsManager.js:446`). User must hard-reload ST before any side-prompt UI edit or the in-memory copy clobbers the disk edit.
- **characterFilter shape:** `{ isExclude: false, names: string[], tags: [] }` where `names` are avatar basenames produced by `buildEntryCharacterFilter(audience, rosterRows)` from `memoryEntry.js`.
- **Cold-eligible tags only:** `knows`, `believes`, `suspects`. Never deep-save `hiding` (dropped on resolution) or `unaware` (no longer exists in the template after the D6 removal).
- **Commit footer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr
  ```

---

## File Structure

- **Create** `plane2.js` — PURE: `parseToDeepStorage`, `parseUpdateNum`, `isDeepSaveEligible`, `coldFactTitle`, `buildColdFactEntry`, `writeDeepFacts(args, deps)`. One responsibility: turn an Epistemic result into witness-gated cold entries.
- **Create** `tests/plane2.test.js` — unit tests for every `plane2.js` export (DI-mocked).
- **Modify** `sidePrompts.js` — import `writeDeepFacts`; add `maybeDeepSave(...)` + `makeDeepSaveDeps()`; call `maybeDeepSave` at all 3 post-upsert sites (parallel Phase B, sequential, job executor); stash roster in the job payload.
- **Modify (data, doc-first)** `data/default-user/user/files/stmb-side-prompts.json` — `epistemic-tracker`: add `(#N)` + `## To Deep Storage` to prompt/responseFormat (Task 1); add `settings.deepSave` (Task 6).
- **Create (docs)** `docs/two-plane-memory/2026-06-21-epistemic-deepsave-prompt-diff.md` — the Task 1 diff-doc.
- **Setup (ST UI, manual)** create the empty `🏠 TWW2 - Deep Facts` lorebook and enable vectorization for it (Task 6 verification).

---

## Task 1: Epistemic prompt — emit `(#N)` + `## To Deep Storage`

**Files:**
- Create: `docs/two-plane-memory/2026-06-21-epistemic-deepsave-prompt-diff.md`
- Modify (data): `data/default-user/user/files/stmb-side-prompts.json` (`epistemic-tracker` `prompt` + `responseFormat`)

**Interfaces:**
- Produces: the wire format `plane2.parseToDeepStorage` consumes — section heading `## To Deep Storage`, one item per line `- <tag> | <about> | <fact> | <reason>`; and `(#N)` age tags on hot Knows/Suspects/Believes items consumed by `parseUpdateNum`.

- [ ] **Step 1: Write the diff-doc** at the path above with these exact before/after blocks:

  - E1 (prompt, rule 2):
    - BEFORE: `2. ONLY the four sections in the Response Format, in order. No prose outside them.`
    - AFTER: `2. ONLY the four knowledge sections (Knows, Suspects, Believes, Hiding) plus the transient \`## To Deep Storage\` list, in order. No prose outside them.`
  - E2 (prompt, the "Keep ACTIVE/hot items only" paragraph):
    - BEFORE: `Keep ACTIVE/hot items only — a few per section. Resolved or distant knowledge ages out (a later phase moves it to deep storage). No prior entry → start fresh, mark "(initial)".`
    - AFTER: `Keep ACTIVE/hot items only — a few per section. Each Knows/Suspects/Believes item carries \`(#N)\` = the update it was first noted or last re-confirmed; age = current# - N (re-stamp N when re-confirmed). When such an item is resolved, or has aged out (age >= 3 and not relevant to the current scene), MOVE it to \`## To Deep Storage\` — it leaves the hot sections (do NOT also list it above). Hiding that is no longer secret is simply dropped, NOT deep-saved. No prior entry → start fresh, mark "(initial)".`
  - E3 (responseFormat): append `` `(#N)` `` to the Knows/Suspects/Believes item lines, and append this section after `## Hiding`:
    ```
    ## To Deep Storage
    (items leaving hot this run; pipe-delimited; omit the whole section if none)
    - knows|believes|suspects | [about whom] | [fact, paraphrased] | resolved|distant
    ```

- [ ] **Step 2: Back up the live store**

Run:
```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
cp -v user/files/stmb-side-prompts.json user/files/stmb-side-prompts.json.bak-20260621-deepsave
```
Expected: `'...' -> '...bak-20260621-deepsave'`

- [ ] **Step 3: Apply the 3 edits with count asserts**

```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
python3 - <<'PY'
import json
p="user/files/stmb-side-prompts.json"
d=json.load(open(p,encoding="utf-8")); et=d["prompts"]["epistemic-tracker"]
OLD1="ONLY the four sections in the Response Format, in order. No prose outside them."
NEW1="ONLY the four knowledge sections (Knows, Suspects, Believes, Hiding) plus the transient `## To Deep Storage` list, in order. No prose outside them."
OLD2='Keep ACTIVE/hot items only — a few per section. Resolved or distant knowledge ages out (a later phase moves it to deep storage). No prior entry → start fresh, mark "(initial)".'
NEW2='Keep ACTIVE/hot items only — a few per section. Each Knows/Suspects/Believes item carries `(#N)` = the update it was first noted or last re-confirmed; age = current# - N (re-stamp N when re-confirmed). When such an item is resolved, or has aged out (age >= 3 and not relevant to the current scene), MOVE it to `## To Deep Storage` — it leaves the hot sections (do NOT also list it above). Hiding that is no longer secret is simply dropped, NOT deep-saved. No prior entry → start fresh, mark "(initial)".'
OLD3="## Knows\n- [about whom] — [fact]\n\n## Suspects\n- [about whom] — [suspicion]\n\n## Believes (may be false)\n- [about whom] — [belief]\n\n## Hiding\n- from [whom] — [secret]"
NEW3="## Knows\n- [about whom] — [fact] `(#N)`\n\n## Suspects\n- [about whom] — [suspicion] `(#N)`\n\n## Believes (may be false)\n- [about whom] — [belief] `(#N)`\n\n## Hiding\n- from [whom] — [secret]\n\n## To Deep Storage\n(items leaving hot this run; pipe-delimited; omit the whole section if none)\n- knows|believes|suspects | [about whom] | [fact, paraphrased] | resolved|distant"
def repl(s,o,n,l):
    c=s.count(o); assert c==1,f"{l}: found {c}"; return s.replace(o,n)
et["prompt"]=repl(et["prompt"],OLD1,NEW1,"E1")
et["prompt"]=repl(et["prompt"],OLD2,NEW2,"E2")
et["responseFormat"]=repl(et["responseFormat"],OLD3,NEW3,"E3")
assert "## To Deep Storage" in et["responseFormat"] and "age = current# - N" in et["prompt"]
json.dump(d,open(p,"w",encoding="utf-8"),indent=2,ensure_ascii=False); open(p,"a").write("\n")
json.load(open(p,encoding="utf-8")); print("OK")
PY
```
Expected: `OK`

- [ ] **Step 4: Structural diff — only epistemic-tracker changed**

```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
python3 - <<'PY'
import json
n=json.load(open("user/files/stmb-side-prompts.json",encoding="utf-8"))
o=json.load(open("user/files/stmb-side-prompts.json.bak-20260621-deepsave",encoding="utf-8"))
def df(a,b,p=""):
    r=[]
    if isinstance(a,dict) and isinstance(b,dict):
        for k in set(a)|set(b): r+=df(a.get(k),b.get(k),p+"/"+str(k))
    elif a!=b: r.append(p)
    return r
print(df(o,n))
PY
```
Expected: `['/prompts/epistemic-tracker/prompt', '/prompts/epistemic-tracker/responseFormat']`

- [ ] **Step 5: Commit**

```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
git -C /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks add docs/two-plane-memory/2026-06-21-epistemic-deepsave-prompt-diff.md
git -C /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks commit -m "docs: epistemic deep-save prompt diff (To Deep Storage + (#N))

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```
(The data file lives outside the repo; it is applied live, tracked via the diff-doc.)

---

## Task 2: `plane2.js` — `parseToDeepStorage` + `parseUpdateNum`

**Files:**
- Create: `plane2.js`
- Test: `tests/plane2.test.js`

**Interfaces:**
- Produces: `parseToDeepStorage(text: string) -> {tag, about, fact, reason}[]`; `parseUpdateNum(text: string) -> number|null`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/plane2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToDeepStorage, parseUpdateNum } from '../plane2.js';

const SAMPLE = `*Epistemic #7 | Scene: kitchen*

## Knows
- Sachin — moved in `+'`(#5)`'+`

## To Deep Storage
- knows | Sachin | lost his IndraNagar flat and hides the debt | resolved
- believes | Aisha | is still single | distant
- garbage line without pipes
- hiding | Aisha | the affair | resolved

## Hiding
- from Aisha — the affair`;

test('parseToDeepStorage extracts pipe rows, skips malformed', () => {
  const items = parseToDeepStorage(SAMPLE);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { tag: 'knows', about: 'Sachin', fact: 'lost his IndraNagar flat and hides the debt', reason: 'resolved' });
  assert.equal(items[1].tag, 'believes');
  assert.equal(items[2].tag, 'hiding'); // parse keeps it; eligibility filtered later
});

test('parseToDeepStorage returns [] when no section', () => {
  assert.deepEqual(parseToDeepStorage('## Knows\n- x — y'), []);
});

test('parseUpdateNum reads the header number', () => {
  assert.equal(parseUpdateNum(SAMPLE), 7);
  assert.equal(parseUpdateNum('no header'), null);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks && node --test tests/plane2.test.js`
Expected: FAIL — `Cannot find module '../plane2.js'`

- [ ] **Step 3: Create `plane2.js` with the two parsers**

```javascript
// plane2.js — PURE Epistemic deep-save helpers (Plane-2c). No SillyTavern imports.
// All ST impurity (load/save/upsert) is injected via `deps` into writeDeepFacts.
import { buildEntryCharacterFilter } from './memoryEntry.js';

/** Parse the "## To Deep Storage" section -> [{tag, about, fact, reason}]. Malformed lines skipped. */
export function parseToDeepStorage(text) {
    const out = [];
    let inSection = false;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (/^##\s+/.test(line)) { inSection = /^##\s+to\s+deep\s+storage\b/i.test(line); continue; }
        if (!inSection || !line.startsWith('-')) continue;
        const parts = line.replace(/^-\s*/, '').split('|').map(s => s.trim());
        if (parts.length < 4) continue;
        const [tag, about, fact, reason] = parts;
        if (!tag || !about || !fact) continue;
        out.push({ tag: tag.toLowerCase(), about, fact, reason: (reason || '').toLowerCase() });
    }
    return out;
}

/** Read the "Epistemic #N" header number, or null. */
export function parseUpdateNum(text) {
    const m = String(text || '').match(/Epistemic\s+#(\d+)/i);
    return m ? Number(m[1]) : null;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test tests/plane2.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
git add plane2.js tests/plane2.test.js
git commit -m "feat(plane2): parse To Deep Storage section + update number

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```

---

## Task 3: `plane2.js` — eligibility + cold-entry builder

**Files:**
- Modify: `plane2.js`
- Test: `tests/plane2.test.js`

**Interfaces:**
- Consumes: `buildEntryCharacterFilter(audience: string[], rosterRows: {name,avatar}[])` from `memoryEntry.js`.
- Produces: `isDeepSaveEligible(tag) -> boolean`; `coldFactTitle(charName, item) -> string`; `buildColdFactEntry(item, charTarget, rosterRows, opts?) -> {title, content, keys, characterFilter, metadata} | null`.

- [ ] **Step 1: Write the failing tests** (append to `tests/plane2.test.js`)

```javascript
import { isDeepSaveEligible, coldFactTitle, buildColdFactEntry } from '../plane2.js';

const ROSTER = [{ name: 'Shilpa', avatar: 'Shilpa.png' }, { name: 'Aisha', avatar: 'Aisha.png' }];
const SHILPA = { name: 'Shilpa', avatar: 'Shilpa.png' };

test('isDeepSaveEligible: only knows/believes/suspects', () => {
  assert.equal(isDeepSaveEligible('knows'), true);
  assert.equal(isDeepSaveEligible('Believes'), true);
  assert.equal(isDeepSaveEligible('suspects'), true);
  assert.equal(isDeepSaveEligible('hiding'), false);
  assert.equal(isDeepSaveEligible('unaware'), false);
});

test('buildColdFactEntry gates to the knower, marks believes-false', () => {
  const item = { tag: 'believes', about: 'Aisha', fact: 'is still single', reason: 'distant' };
  const e = buildColdFactEntry(item, SHILPA, ROSTER, { updateNum: 7 });
  assert.deepEqual(e.characterFilter, { isExclude: false, names: ['Shilpa'], tags: [] });
  assert.match(e.content, /Shilpa believes \(possibly falsely\) about Aisha: is still single/);
  assert.deepEqual(e.keys, ['Aisha']);
  assert.equal(e.metadata.STMB_deepFalse, true);
  assert.equal(e.metadata.STMB_deepTag, 'believes');
  assert.equal(e.metadata.STMB_deepSince, 7);
});

test('buildColdFactEntry returns null for ineligible tag', () => {
  assert.equal(buildColdFactEntry({ tag: 'hiding', about: 'Aisha', fact: 'x' }, SHILPA, ROSTER), null);
});

test('coldFactTitle is stable + dedup-bearing (same fact -> same title)', () => {
  const it = { tag: 'knows', about: 'Sachin', fact: 'lost his flat and hides the debt' };
  assert.equal(coldFactTitle('Shilpa', it), coldFactTitle('Shilpa', it));
  assert.match(coldFactTitle('Shilpa', it), /^\[Deep\]\[Shilpa\] knows:Sachin —/);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test tests/plane2.test.js`
Expected: FAIL — `isDeepSaveEligible is not a function` (import error)

- [ ] **Step 3: Implement (append to `plane2.js`)**

```javascript
const COLD_TAGS = new Set(['knows', 'believes', 'suspects']);
const PHRASE = { knows: 'knows', believes: 'believes (possibly falsely)', suspects: 'suspects' };

export function isDeepSaveEligible(tag) {
    return COLD_TAGS.has(String(tag || '').trim().toLowerCase());
}

function slug(s, n = 48) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Stable, dedup-bearing title (upsert-by-title => idempotent). */
export function coldFactTitle(charName, item) {
    return `[Deep][${charName}] ${item.tag}:${item.about} — ${slug(item.fact)}`;
}

/** Cold-fact lorebook entry gated to the knower. null if tag not cold-eligible. */
export function buildColdFactEntry(item, charTarget, rosterRows, opts = {}) {
    if (!item || !charTarget || !isDeepSaveEligible(item.tag)) return null;
    const charName = String(charTarget.name);
    const cf = buildEntryCharacterFilter([charName.toLowerCase()], rosterRows);
    const characterFilter = cf ? { isExclude: false, names: cf.names, tags: cf.tags || [] } : null;
    const content = `${charName} ${PHRASE[item.tag]} about ${item.about}: ${item.fact}.`;
    const metadata = {
        STMB_deep: true,
        STMB_deepTag: item.tag,
        STMB_deepAbout: item.about,
        STMB_deepReason: item.reason || '',
        STMB_deepSince: opts.updateNum ?? null,
    };
    if (item.tag === 'believes') metadata.STMB_deepFalse = true;
    return { title: coldFactTitle(charName, item), content, keys: [item.about], characterFilter, metadata };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test tests/plane2.test.js`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
git add plane2.js tests/plane2.test.js
git commit -m "feat(plane2): cold-fact entry builder (witness-gated, believes-false marker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```

---

## Task 4: `plane2.js` — `writeDeepFacts(args, deps)` orchestrator (DI)

**Files:**
- Modify: `plane2.js`
- Test: `tests/plane2.test.js`

**Interfaces:**
- Consumes (injected `deps`): `resolveBookName(tpl) -> string`, `ensureBook(name) -> Promise<data>`, `upsertByTitle(name, data, title, content, opts) -> Promise<any>`.
- Produces: `writeDeepFacts({tpl, charTarget, resultText, rosterRows, updateNum}, deps) -> Promise<{written, bookName?, skipped?}>`.

- [ ] **Step 1: Write the failing tests** (append to `tests/plane2.test.js`)

```javascript
import { writeDeepFacts } from '../plane2.js';

function spyDeps() {
  const calls = [];
  return {
    calls,
    resolveBookName: () => '🏠 TWW2 - Deep Facts',
    ensureBook: async () => ({ entries: {} }),
    upsertByTitle: async (name, data, title, content, opts) => { calls.push({ name, title, content, opts }); },
  };
}
const TPL_ON = { settings: { deepSave: { enabled: true } } };
const RESULT = `*Epistemic #4 | Scene: x*\n\n## To Deep Storage\n- knows | Sachin | lost his flat | resolved\n- hiding | Aisha | the affair | resolved`;

test('writeDeepFacts: writes eligible items, drops ineligible, gates per char', async () => {
  const d = spyDeps();
  const r = await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa', avatar: 'Shilpa.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }], updateNum: 4 }, d);
  assert.equal(r.written, 1);                 // hiding dropped
  assert.equal(d.calls.length, 1);
  assert.deepEqual(d.calls[0].opts.entryOverrides.characterFilter.names, ['Shilpa']);
  assert.equal(d.calls[0].opts.defaults.vectorized, true);
});

test('writeDeepFacts: skips when disabled / no char / no items', async () => {
  assert.deepEqual(await writeDeepFacts({ tpl: { settings: {} }, charTarget: { name: 'Shilpa' }, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'disabled' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: null, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'no-char' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa' }, resultText: 'no section' }, spyDeps()), { written: 0 });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test tests/plane2.test.js`
Expected: FAIL — `writeDeepFacts is not a function`

- [ ] **Step 3: Implement (append to `plane2.js`)**

```javascript
/**
 * Eviction -> cold store. PURE via injected deps:
 *   deps.resolveBookName(tpl) -> string
 *   deps.ensureBook(name)     -> Promise<lorebookData>
 *   deps.upsertByTitle(name, data, title, content, opts) -> Promise<any>
 */
export async function writeDeepFacts({ tpl, charTarget, resultText, rosterRows, updateNum } = {}, deps) {
    if (!tpl?.settings?.deepSave?.enabled) return { written: 0, skipped: 'disabled' };
    if (!charTarget) return { written: 0, skipped: 'no-char' };
    const items = parseToDeepStorage(resultText);
    if (!items.length) return { written: 0 };
    const bookName = deps.resolveBookName(tpl);
    if (!bookName) return { written: 0, skipped: 'no-book' };
    const since = updateNum ?? parseUpdateNum(resultText);
    const data = await deps.ensureBook(bookName);
    let written = 0;
    for (const item of items) {
        const entry = buildColdFactEntry(item, charTarget, rosterRows, { updateNum: since });
        if (!entry) continue;
        await deps.upsertByTitle(bookName, data, entry.title, entry.content, {
            defaults: { vectorized: true },
            entryOverrides: { key: entry.keys, characterFilter: entry.characterFilter, ...entry.metadata },
        });
        written++;
    }
    return { written, bookName };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test tests/plane2.test.js`
Expected: PASS (9 tests). Then run the whole suite — `node --test tests/` — expect **199 pass / 0 fail** (190 baseline + 9).

- [ ] **Step 5: Commit**

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
git add plane2.js tests/plane2.test.js
git commit -m "feat(plane2): writeDeepFacts DI orchestrator (eviction -> cold store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```

---

## Task 5: Wire `writeDeepFacts` into all 3 completion paths

**Files:**
- Modify: `sidePrompts.js` (imports near line 21; new helpers; call sites ~2150 parallel, ~2314 sequential, ~1624 job executor; payload at ~1980 enqueue)

**Interfaces:**
- Consumes: `writeDeepFacts` (Task 4); `resolveLorebookNameMacros` (`./lorebookNameMacros.js`), `pickWorld`/`readActiveWorldName` (`./worldScopeBridge.js`), `loadWorldInfo`/`saveWorldInfo` + `upsertLorebookEntryByTitle` (already imported in `sidePrompts.js`), `discoverChatCharacters()` (already in `sidePrompts.js`, returns `{name, avatar}[]` = rosterRows).
- Produces: `maybeDeepSave({tpl, charTarget, resultText, rosterRows})` called identically at every completion path (centralized — avoids the 3-path divergence bug).

- [ ] **Step 1: Add imports + helpers** near the top of `sidePrompts.js` (after the existing `worldScopeBridge`/`lorebookNameMacros` imports):

```javascript
import { writeDeepFacts } from './plane2.js';

function makeDeepSaveDeps() {
    return {
        resolveBookName: (tpl) => resolveLorebookNameMacros(
            tpl?.settings?.deepSave?.bookName || '{{group}} - Deep Facts',
            { groupName: pickWorld(readActiveWorldName()) }),
        ensureBook: async (name) => {
            let d = await loadWorldInfo(name).catch(() => null);
            if (!d || !d.entries) { d = { entries: {} }; await saveWorldInfo(name, d, true); }
            return d;
        },
        upsertByTitle: (name, data, title, content, opts) =>
            upsertLorebookEntryByTitle(name, data, title, content, opts),
    };
}

async function maybeDeepSave({ tpl, charTarget, resultText, rosterRows }) {
    if (!tpl?.settings?.deepSave?.enabled || !charTarget) return;
    try {
        const r = await writeDeepFacts(
            { tpl, charTarget, resultText, rosterRows: rosterRows || discoverChatCharacters() },
            makeDeepSaveDeps());
        if (r?.written) console.log(`${MODULE_NAME}: deep-save wrote ${r.written} fact(s) for ${charTarget.name} -> ${r.bookName}`);
    } catch (e) {
        console.warn(`${MODULE_NAME}: deep-save failed for ${charTarget?.name}:`, e);
    }
}
```

- [ ] **Step 2: Call it at the SEQUENTIAL path** — in `sidePrompts.js` immediately AFTER the per-character upsert `try{...}` block completes (the `upsertLorebookEntryByTitle(charLore.name, ...)` site ~line 2314), inside the loop, add:

```javascript
            await maybeDeepSave({ tpl, charTarget, resultText });
```

- [ ] **Step 3: Call it at the PARALLEL Phase B path** — after the per-character `upsertLorebookEntryByTitle(charLore.name, ...)` (~line 2150), where `slot.resultText` (or the loop's `resultText`) and `charTarget` are in scope, add the same call using that path's result variable:

```javascript
            await maybeDeepSave({ tpl, charTarget, resultText: slot.resultText });
```
(Use whatever the Phase B loop names the per-character result + charTarget; match the existing upsert call's variables.)

- [ ] **Step 4: Wire the JOB path** — (a) at the enqueue site (~1980) add a roster snapshot to the payload so the deferred executor has it:

```javascript
        if (await enqueueSidePromptJob({
            tpl, charTarget, lore: charLore || tplLores[0], compiled,
            defaultOverrides, fallbackKinds: ['tracker'], trigger: 'onInterval',
            rosterRows: discoverChatCharacters(),
        })) queued++;
```
  (b) ensure `enqueueSidePromptJob`/`buildSidePromptJob` carry `charTarget` + `rosterRows` onto the job payload; (c) in `executeQueuedSidePromptJob` after its `upsertLorebookEntryByTitle(..., text, ...)` (~1624) add:

```javascript
        await maybeDeepSave({ tpl, charTarget: payload.charTarget, resultText: text, rosterRows: payload.rosterRows });
```

- [ ] **Step 5: Build + manual verify** (the wiring touches live ST; pure logic is already unit-tested in Tasks 2-4)

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
bun run build.ts && node --test tests/
```
Expected: build OK; **199 pass / 0 fail**. Then (after Task 6 setup + ST reload) run one Epistemic generation that ages a fact out and confirm a gated, vectorized entry appears in `🏠 TWW2 - Deep Facts` — see Task 6 Step 4.

- [ ] **Step 6: Commit**

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
git add sidePrompts.js index.build.js
git commit -m "feat(sideprompts): wire deep-save into all 3 epistemic completion paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```

---

## Task 6: Enable deep-save on the Epistemic template + create the cold book

**Files:**
- Modify (data, doc-first): `data/default-user/user/files/stmb-side-prompts.json` (`epistemic-tracker.settings.deepSave`)
- Setup (ST UI, manual): create `🏠 TWW2 - Deep Facts`; enable vectorization for it.

- [ ] **Step 1: Back up + add the `deepSave` setting**

```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
cp -v user/files/stmb-side-prompts.json user/files/stmb-side-prompts.json.bak-20260621-deepsave-setting
python3 - <<'PY'
import json
p="user/files/stmb-side-prompts.json"
d=json.load(open(p,encoding="utf-8"))
d["prompts"]["epistemic-tracker"]["settings"]["deepSave"]={"enabled":True,"bookName":"{{group}} - Deep Facts"}
json.dump(d,open(p,"w",encoding="utf-8"),indent=2,ensure_ascii=False); open(p,"a").write("\n")
json.load(open(p,encoding="utf-8")); print("OK")
PY
```
Expected: `OK`

- [ ] **Step 2: Structural diff — only the deepSave key added**

```bash
cd /ssd/tools/docker/apps/chat.ai/sillytavern/data/default-user
python3 - <<'PY'
import json
n=json.load(open("user/files/stmb-side-prompts.json",encoding="utf-8"))
o=json.load(open("user/files/stmb-side-prompts.json.bak-20260621-deepsave-setting",encoding="utf-8"))
def df(a,b,p=""):
    r=[]
    if isinstance(a,dict) and isinstance(b,dict):
        for k in set(a)|set(b): r+=df(a.get(k),b.get(k),p+"/"+str(k))
    elif a!=b: r.append(p)
    return r
print(df(o,n))
PY
```
Expected: `['/prompts/epistemic-tracker/settings/deepSave']`

- [ ] **Step 3: Create the cold book in ST (manual, reliable path)**

In the ST UI → World Info → create a new lorebook named exactly `🏠 TWW2 - Deep Facts`, leave it empty, save. Then enable vectorization for it (Vector Storage extension → include this book / set its entries to vectorized). The runtime `ensureBook` will create it if missing, but pre-creating guarantees ST registers it for retrieval.

- [ ] **Step 4: Hard-reload ST + live verify**

- Reload ST (so the updated `stmb-side-prompts.json` is re-fetched).
- Regenerate each character's Epistemic tracker once so they re-emit with `(#N)` tags.
- Drive a scene until a fact ages out (or manually `/sideprompt` after enough updates) and confirm:
  - the hot Epistemic entry shrinks (the item leaves Knows/Suspects/Believes),
  - a new entry appears in `🏠 TWW2 - Deep Facts`, `characterFilter` gated to the knower only, `vectorized: true`,
  - the same fact evicted twice does NOT duplicate (same title → upsert update).
- Witness check: confirm a Shilpa-gated Deep Fact never activates when generating Aisha.

- [ ] **Step 5: Commit the diff-doc note**

```bash
cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks
# update the Task 1 diff-doc Status to APPLIED incl. the deepSave setting, then:
git add docs/two-plane-memory/2026-06-21-epistemic-deepsave-prompt-diff.md
git commit -m "docs: mark epistemic deep-save prompt + setting applied

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GEAtWs1kh4VLwnhqFRKfr"
```

---

## Self-Review

**Spec coverage (spec §-by-§):**
- §2 hot/cold two-tier, Hybrid → Tasks 1 (hot emit), 2-4 (cold build), 5 (native retrieval = no code; write wiring), 6 (book + vectorization). ✓
- §3 explicit `## To Deep Storage` eviction (not diff) → Task 1 (emit) + Task 2 (parse). ✓
- §4 cold-eligible = knows/believes/suspects; hiding/unaware excluded → `isDeepSaveEligible` (Task 3) + parse keeps-but-filter (Tasks 2/3 tests). ✓
- §5 entry shape (body+keys+characterFilter+metadata, believes-false) → `buildColdFactEntry` (Task 3). ✓
- §6 native retrieval, characterFilter-gated, vectorized → `vectorized:true` + gate (Tasks 4/5) + book vectorization (Task 6). ✓ Over-pull dials (max_entries/threshold) = ST-config, noted in Task 6 (tune live).
- §7 re-promotion v1 organic → no code by design (D4). ✓
- §9 D1 book name `🏠 TWW2 - Deep Facts` (Task 5 resolver, Task 6 setting); D2 per-fact (one entry/fact, Task 3); D3 age≥3 (Task 1 prompt); D5 hiding drop (Task 1 + eligibility). ✓
- §10 drift mitigated by explicit eviction (Task 1); cross-char leak prevented by characterFilter (Tasks 3/4 tests). ✓

**Placeholder scan:** none — every code/step has concrete content. The two impure steps (Task 5 wiring) carry exact call snippets + a live-verify (the codebase has no ST-mock harness for sidePrompts; pure logic is fully unit-tested in 2-4). Flagged honestly, not hidden.

**Type consistency:** `writeDeepFacts` arg/return, `buildColdFactEntry` return shape, `characterFilter {isExclude,names,tags}`, and `entryOverrides.key` (keyword field name per the entry shape) are consistent across Tasks 3-5. `rosterRows = discoverChatCharacters()` shape `{name,avatar}` matches `buildEntryCharacterFilter`'s expectation.

**Open risk to watch at execution:** Task 5 Step 3/4 must match the *actual* per-character result variable names in the parallel Phase B loop and the job executor (`slot.resultText` / `text`) — verify against the live code at execution, since those are the only spots not covered by a unit test.
