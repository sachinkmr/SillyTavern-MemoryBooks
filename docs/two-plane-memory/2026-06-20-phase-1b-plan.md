# Phase 1b — Audience segmentation (N entries per scene) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generalize Plane-1 from one objective entry per scene (1a, single-segment) to **N audience-homogeneous segments per scene** — one objective summary + gated entry per segment — so enter/exit/whisper are recorded witness-correctly. Single-perceiver segments are dropped. Un-skips acceptance U4 (enter) / U5 (exit-return) / E9 (grow-shrink).

**Architecture:** A new pure `computePlane1Segments` splits the (post-unreal) scene into contiguous runs of identical audience composition, drops single-perceiver runs, and returns one segment result per run (each a self-contained `filteredScene` of just that run's messages + its `characterFilter`). The pipeline seams switch from the 1a single-`computePlane1Memory` path to a **loop over segments** (per-segment `createMemory` + `addMemoryToLorebook`), with the per-scene-once side-effects (save, auto-hide, high-water, after-memory, consolidation, toast) lifted to run **once after** the loop. The two-plane path becomes an early-return branch so the flag-off path stays byte-identical. Behind `moduleSettings.twoPlaneMemory` (default off), same as 1a.

**Tech Stack:** ES modules; Node test runner (`node --test`); the Phase 0/1a pure helpers in `witnessScope.js` / `memoryEntry.js` / `plane1.js`; ST World Info write path in `addlore.js`; job queue in `index.js`/`stmbJobs.js`.

## Global Constraints

Every task implicitly includes this section. Copy values verbatim.

- **Test runner:** `node --test tests/` (`node:test` + `node:assert/strict`, ES modules). No framework.
- **Flag-off byte-identity:** with `twoPlaneMemory` false, behavior is unchanged. The two-plane handling is an **early-return branch**; the remaining (flag-off) code path is the pre-1b code with the 1a interleaved `isTwoPlane()` bits removed (those were no-ops when off, so removal preserves flag-off behavior exactly).
- **Per-scene-once invariant:** for a scene that splits into N segments, these run **exactly once** (not per segment): `saveWorldInfo` (or rely on per-call save — see Task 2), auto-hide of the whole scene, `updateHighestMemoryProcessed`/`updateHighestMemoryProcessedForChatRef` to the SCENE end, `runAfterMemory`, `clearAutoSummaryState`, `maybePromptSelectedAutoConsolidation`, and the success toast (which summarizes N entries).
- **Segment rule:** walk the post-unreal messages in order; a NEW segment starts when a message's audience SET differs from the current run's set (set-equality on sorted, lowercased, de-duped tokens). An **unstamped** message (`audienceOf===null`) EXTENDS the current run (fail-open, inherits its gate); a leading unstamped run (no prior run) is its own ungated (fail-open) segment.
- **Single-perceiver drop:** a run whose audience has exactly **one** perceiver (`audience.length === 1`) is dropped from Plane-1 (it is Plane-2 material). `{{user}}`/persona token COUNTS toward the perceiver count — so `[user, aisha]` (2) is kept; `[aisha]` alone (1) is dropped. The user token is still excluded only from `characterFilter.names`.
- **Whisper = its own segment:** a whisper narrows the audience → a distinct run → a content entry gated to the whisperers. Non-witnesses get nothing (the SHELL — "a whisper happened" — is Phase 2). Do NOT special-case whispers in 1b; the segment rule handles them.
- **Segments are a disjoint partition:** each message belongs to exactly one segment; total messages across segments == scene messages (so payload/clone size ≈ one scene, not N×).
- **characterFilter contract (unchanged):** avatar basenames via `buildEntryCharacterFilter`; fail-open = `null` (ungated); fail-closed (N9) = `{names:[]}` (nobody).
- **Preview UX:** **auto-accept when segmented** (N>1) — skip per-segment previews and write all segment entries. When N==1 (homogeneous scene), keep the existing single-memory preview behavior unchanged.
- **JSON-repair stays single-segment:** `applyManualFixedJson` repairs one failed segment's entry; no multi-segment change (the failing segment's context is captured in `lastFailedAIContext`).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `plane1.js` | modify (add 1 fn) | `computePlane1Segments(compiledScene, chat, rosterRows, opts)` → `SegmentResult[]`. `computePlane1Memory` retained unchanged (its tests + the trivial homogeneous case). |
| `addlore.js` | modify | Export `applySceneAutoHide(sceneRange, moduleSettings)` (run whole-scene auto-hide once after a segment loop). Confirm `populateLorebookEntry` already derives `STMB_start/STMB_end` from `memoryResult.metadata.sceneRange` (per-segment sub-range). |
| `index.js` | modify (2 seams) | `executeMemoryGeneration` (non-queued) + `buildQueuedMemoryJob`/`executeQueuedMemoryJob` (queued): switch to `computePlane1Segments` + segment loop; per-scene-once steps after the loop; flag-off path de-interleaved to original. |
| `tests/plane1.test.js` | modify | Add `computePlane1Segments` fixtures: U4/U5/E9 + single-perceiver-drop + unstamped-failopen + homogeneous-is-1-segment + dead-filter. |
| `tests/witness-pov.test.js` | modify | Replace the skipped `U4/U5/E9 enter-exit segmentation` stub with an active pointer (mirrors the Phase-1a pointer); keep U6 (Phase 2) skipped. |

---

### Task 1: `computePlane1Segments` (pure) + acceptance tests — the de-risk heart

**Files:**
- Modify: `plane1.js` (add `computePlane1Segments`, keep `computePlane1Memory`)
- Test: `tests/plane1.test.js` (add segment fixtures); `tests/witness-pov.test.js` (un-skip → pointer)

**Interfaces:**
- Consumes: `dropUnrealFromCompiledScene`, `audienceOf` (`./witnessScope.js`); `buildEntryCharacterFilter` (`./memoryEntry.js`). (All already imported in plane1.js.)
- Produces: `computePlane1Segments(compiledScene, chat, rosterRows, opts={userToken}) -> Array<{ filteredScene, characterFilter, audience:string[], sceneStart:number, sceneEnd:number, segmentIndex:number }>`. Empty array = nothing to record (all-unreal or all single-perceiver).

- [ ] **Step 1: Write the failing tests** (append to `tests/plane1.test.js`; reuse its existing `fixture(rows)` + `ROSTER3`)

```javascript
import { computePlane1Segments } from '../plane1.js';

const segIds = s => s.filteredScene.messages.map(m => m.id);

test('U2 homogeneous: full-group scene is exactly ONE segment (no spurious split)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
});

test('U4 enter: Aisha joins mid-scene → 2 segments; Aisha never fed pre-entry msg', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // seg0 — before Aisha
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // seg1 — Aisha present
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].characterFilter.names, ['Shilpa']);
  assert.deepEqual(segIds(segs[0]), [0]);                          // Aisha NOT in seg0
  assert.deepEqual(segs[1].characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.deepEqual(segIds(segs[1]), [1]);
});

test('U5 exit-return: Aisha leaves then returns → 3 segments; Aisha gets seg0+seg2 only', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },    // seg0
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // seg1 — Aisha gone
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // seg2 — Aisha back
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);
  assert.deepEqual(segIds(segs[1]), [1]);
  assert.deepEqual(segs[1].characterFilter.names, ['Shilpa']);    // Aisha excluded from seg1
  // Aisha's memory = union of seg0+seg2 (segments where she is in audience), never seg1.
  const aishaSegs = segs.filter(s => s.audience.includes('aisha'));
  assert.deepEqual(aishaSegs.map(s => segIds(s)).flat(), [0, 2]);
});

test('E9 grow/shrink: each segment is one audience run; disjoint partition', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // run A
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // run B
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // run B (same set → same seg)
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // run C
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);
  assert.deepEqual(segIds(segs[0]), [0]);
  assert.deepEqual(segIds(segs[1]), [1, 2]);                       // contiguous same-set run merges
  assert.deepEqual(segIds(segs[2]), [3]);
  const all = segs.flatMap(segIds).sort((a, b) => a - b);
  assert.deepEqual(all, [0, 1, 2, 3]);                            // disjoint, complete
});

test('single-perceiver drop: a [aisha]-only run is dropped; mixed scene keeps the rest', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['aisha'] },                       // single perceiver → drop
    { name: 'Aisha', audience: ['user', 'aisha'] },               // 2 perceivers → keep
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segIds(segs[0]), [1]);
  assert.deepEqual(segs[0].characterFilter.names, ['Aisha']);
});

test('all single-perceiver / all-unreal → empty array', () => {
  const a = fixture([{ name: 'Aisha', audience: ['aisha'] }]);
  assert.deepEqual(computePlane1Segments(a.compiledScene, a.chat, ROSTER3, { userToken: 'user' }), []);
  const b = fixture([{ name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' }]);
  assert.deepEqual(computePlane1Segments(b.compiledScene, b.chat, ROSTER3, { userToken: 'user' }), []);
});

test('unstamped extends current run (fail-open, inherits gate)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'] },               // stamped run
    { name: 'Aisha' },                                            // unstamped → extends run, no new seg
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
  assert.deepEqual(segs[0].characterFilter.names, ['Aisha']);
});

test('fully unstamped scene → one fail-open (ungated) segment', () => {
  const { chat, compiledScene } = fixture([{ name: 'Aisha' }, { name: 'Shilpa' }]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.equal(segs[0].characterFilter, null);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
});

test('dead-filter: per-segment gate uses avatar basenames', () => {
  const { chat, compiledScene } = fixture([{ name: 'Priya Mehta', audience: ['user', 'priya mehta'] }]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(segs[0].characterFilter.names, ['Priya']);     // NOT 'Priya Mehta'
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/plane1.test.js` → FAIL (`computePlane1Segments` not exported).

- [ ] **Step 3: Implement** (append to `plane1.js`)

```javascript
/**
 * Segment a scene into contiguous audience-homogeneous runs; one objective gated entry per run.
 * Generalizes computePlane1Memory (1a). Drops single-perceiver runs (Plane-2 material).
 * Unstamped messages extend the current run (fail-open). A leading unstamped run is ungated.
 * @returns {Array<{filteredScene, characterFilter, audience:string[], sceneStart, sceneEnd, segmentIndex}>}
 *   empty array when nothing to record (all-unreal or all single-perceiver).
 */
export function computePlane1Segments(compiledScene, chat, rosterRows, opts = {}) {
    const userToken = String(opts.userToken || '').trim().toLowerCase();
    const real = dropUnrealFromCompiledScene(compiledScene, chat);
    if (!real.messages.length) return [];

    // 1. Split into contiguous runs of identical audience composition.
    const runs = [];
    let cur = null;
    for (const cm of real.messages) {
        const aud = audienceOf(chat?.[cm.id]);                                  // lowercased[] | null
        const tokens = aud === null ? null : [...new Set(aud)].sort();
        const key = tokens === null ? null : tokens.join(' ');
        if (cur && (aud === null || key === cur.key)) {
            cur.messages.push(cm);                                              // extend (same set, or unstamped)
        } else {
            cur = { key, tokens, messages: [cm] };
            runs.push(cur);
        }
    }

    // 2. One segment per run; drop single-perceiver runs.
    const segments = [];
    for (const run of runs) {
        const audience = run.tokens;                                            // null => fail-open run
        if (audience && audience.length === 1) continue;                        // single perceiver → drop
        const ids = run.messages.map(m => m.id);
        const filteredScene = {
            ...real,
            messages: run.messages,
            metadata: {
                ...real.metadata,
                messageCount: run.messages.length,
                sceneStart: ids[0],
                sceneEnd: ids[ids.length - 1],
            },
        };
        const characterFilter = audience
            ? buildEntryCharacterFilter(audience.filter(t => t !== userToken), rosterRows)
            : null;                                                             // fail-open run → ungated
        segments.push({
            filteredScene,
            characterFilter,
            audience: audience || [],
            sceneStart: ids[0],
            sceneEnd: ids[ids.length - 1],
            segmentIndex: segments.length,
        });
    }
    return segments;
}
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/plane1.test.js` → PASS. Then full suite `node --test tests/` → 0 fail (the 1a `computePlane1Memory` tests still pass unchanged).

- [ ] **Step 5: Un-skip the acceptance pointer** — in `tests/witness-pov.test.js`, replace the `test('U4/U5/E9 enter-exit segmentation', { skip: ... }, ...)` stub with:
```javascript
test('U4/U5/E9 enter-exit segmentation is covered by tests/plane1.test.js (computePlane1Segments)', () => {
  assert.ok(true);
});
```
Keep the U6 (Phase 2) skip stub.

- [ ] **Step 6: Commit** — `git add plane1.js tests/plane1.test.js tests/witness-pov.test.js && git commit -m "feat(memory): computePlane1Segments — audience segmentation (Phase 1b)"`

---

### Task 2: `addlore.js` — `applySceneAutoHide` export (whole-scene auto-hide once)

**Files:**
- Modify: `addlore.js`

**Why:** the segment loop calls `addMemoryToLorebook` with `autoHide:false` per segment; auto-hide for the WHOLE scene must run once afterward (a segment's own sub-range is wrong for hiding). Today the hide execution is internal to `addMemoryToLorebook` (`getAutoHideRanges` @86 + `safeExecuteHideCommand` @59). Expose a standalone runner.

**Interfaces:**
- Produces: `async applySceneAutoHide(sceneRange: string, moduleSettings = {}) -> void` — runs `getAutoHideRanges({ metadata: { sceneRange } }, moduleSettings)` and executes each resulting range via the existing `safeExecuteHideCommand`. No-op when mode is `none` or range invalid.
- Confirms (no change): `populateLorebookEntry` derives `STMB_start/STMB_end` from `memoryResult.metadata.sceneRange` (addlore.js:627-633) — so a per-segment caller setting `memoryResult.metadata.sceneRange` to the segment sub-range gets correct per-segment STMB markers automatically.

- [ ] **Step 1: Implement** — add near `getAutoHideRanges`:
```javascript
/** Run auto-hide for an entire scene range once (used after a multi-segment write loop). */
export async function applySceneAutoHide(sceneRange, moduleSettings = {}) {
    const result = getAutoHideRanges({ metadata: { sceneRange } }, moduleSettings);
    if (!result || result.mode === 'none' || result.invalidRange) return;
    for (const range of (result.ranges || [])) {
        await safeExecuteHideCommand(`/hide ${range.start}-${range.end}`, range.contextKey || range.contextFallback || '');
    }
}
```
> Implementer: match the exact `getAutoHideRanges` return shape (`{mode, ranges:[{start,end,contextKey,contextFallback}], invalidRange}`) and the exact `safeExecuteHideCommand` signature already used inside `addMemoryToLorebook` (~lines 556-573); reuse that call form verbatim.

- [ ] **Step 2: Verify** — `node --check addlore.js`; `node --test tests/` unchanged; pre-commit build (addlore is bundled) succeeds.

- [ ] **Step 3: Commit** — `git add addlore.js && git commit -m "feat(memory): export applySceneAutoHide for multi-segment scenes (Phase 1b)"`

---

### Task 3: Non-queued seam — `executeMemoryGeneration` segment loop

**Files:**
- Modify: `index.js` (`executeMemoryGeneration`, ~2426-2841; imports ~195)

**Interfaces:**
- Consumes: `computePlane1Segments` (`./plane1.js`), `getChatRoster`/`resolveWorldMemoriesBook` (`./plane1Context.js`), `applySceneAutoHide` (`./addlore.js`), `saveWorldInfo`/`updateHighestMemoryProcessed` (already imported), live `chat`/`name1`.

**Structure (precise; implementer reads the function and matches actual variable names):**

- [ ] **Step 1: Import** — add `computePlane1Segments` to the existing `./plane1.js` import; add `applySceneAutoHide` to the `./addlore.js` import.

- [ ] **Step 2: Replace the 1a single-path two-plane handling with an early-return segment branch.** After `compiledScene = compileScene(sceneRequest)` and `validateCompiledScene`, insert:

```javascript
    if (isTwoPlane()) {
      const segments = computePlane1Segments(compiledScene, chat, getChatRoster(), { userToken: (name1 || '').toLowerCase() });
      if (!segments.length) return false;                              // nothing real/witnessed → clean no-op
      const plane1Book = await resolveWorldMemoriesBook();
      const lv = plane1Book || lorebookValidation;                     // null world book → chat-bound fallback
      const wholeRange = `${sceneData.sceneStart}-${sceneData.sceneEnd}`;
      const segmented = segments.length > 1;                           // auto-accept previews only when segmented
      const entryTitles = [];
      for (const seg of segments) {
        throwIfStmbStopped(runEpoch);
        const mr = await createMemory(seg.filteredScene, profileSettings, { tokenWarningThreshold: tokenThreshold, signal: stmbTask.signal });
        mr.characterFilter = seg.characterFilter;
        mr.metadata.sceneRange = `${seg.sceneStart}-${seg.sceneEnd}`;  // per-segment STMB_start/end
        let finalMr = mr;
        if (!segmented && settings.moduleSettings.showMemoryPreviews) {
          // N==1: preserve the existing single-memory preview/edit/retry/cancel flow (copy it here),
          //       carrying mr.characterFilter onto the edited result (the popup spreads ...mr so it survives).
          // (Segmented scenes auto-accept: no preview.)
        }
        const addResult = await addMemoryToLorebook(finalMr, lv, {
          expectedChatId: startChatId, autoHide: false, updateHighestMemoryProcessed: false, refreshEditor: false,
        });
        if (!addResult.success) {
          if (addResult.chatChanged) { /* same chat-changed toast + return as today */ return; }
          throw new Error(addResult.error || 'Failed to add memory to lorebook');
        }
        entryTitles.push(addResult.entryTitle);
      }
      // ---- per-scene-once side-effects (run ONCE after all segments) ----
      await applySceneAutoHide(wholeRange, settings.moduleSettings);
      await updateHighestMemoryProcessed({ metadata: { sceneRange: wholeRange, chatId: startChatId } }, startChatId);
      // refresh editor once (use the existing refresh call form); success toast summarizing N entries:
      toastr.success(/* e.g. */ `Saved ${entryTitles.length} memory ${entryTitles.length === 1 ? 'entry' : 'entries'}`, 'STMemoryBooks');
      // then run the existing post-memory steps ONCE (lift them out of the old single path):
      //   runAfterMemory(...), clearAutoSummaryState(...), maybePromptSelectedAutoConsolidation(...)
      return true;                                                     // match the function's success return shape
    }

    // ===== flag-OFF path below: the ORIGINAL pre-1b single-memory code, UNCHANGED =====
    // (Remove the 1a interleaved `if (isTwoPlane())` bits that used to live in this path — they are
    //  now handled by the early branch above and were no-ops when the flag is off, so flag-off behavior
    //  is preserved exactly.)
```

> Implementer notes: (1) Use the function's ACTUAL local names (`profileSettings`/`profile`, `tokenThreshold`, `stmbTask`, `runEpoch`, `startChatId`, the refresh call, `runAfterMemory`/`clearAutoSummaryState`/`maybePromptSelectedAutoConsolidation`) — read the current function. (2) For the N==1 preview branch, lift the existing preview/edit/retry/cancel block verbatim (it currently lives in the single path) so single-segment scenes behave exactly as 1a. (3) The mirror loop is already skipped in two-plane mode (1a fix) — keep it only on the flag-off path. (4) `lastFailedAIContext` capture: on a mid-loop `AIResponseError`, capture the CURRENT segment's `filteredScene` + `seg.characterFilter` + the world book name (so JSON-repair fixes that one segment) — mirror the 1a capture but per-segment.

- [ ] **Step 3: Verify** — `node --check index.js`; `node --test tests/` → 0 fail; pre-commit build succeeds. Re-read the flag-off path and confirm it is the original (no two-plane bits remain inline).

- [ ] **Step 4: Commit** — `git add index.js && git commit -m "feat(memory): non-queued segment loop with per-scene-once side-effects (Phase 1b)"`

---

### Task 4: Queued seam — `buildQueuedMemoryJob` + `executeQueuedMemoryJob` segment loop

**Files:**
- Modify: `index.js` (`buildQueuedMemoryJob` ~3009-3103, `executeQueuedMemoryJob` ~3172-3349)

**Interfaces:**
- Produces: `payload.plane1Segments = Array<{ filteredScene, characterFilter, audience }>` and `payload.plane1BookName` (string|null), computed at enqueue against live chat. (Segments partition the scene → total clone size ≈ one scene.) On skip (empty segments) store `payload.plane1 = { skipped:true }`.

- [ ] **Step 1: `buildQueuedMemoryJob`** — after `compiledScene = compileScene(...)`, when `isTwoPlane()`:
```javascript
    let plane1Segments = null, plane1BookName = null, plane1Skipped = false;
    if (isTwoPlane()) {
      const segs = computePlane1Segments(compiledScene, chat, getChatRoster(), { userToken: (name1 || '').toLowerCase() });
      if (!segs.length) { plane1Skipped = true; }
      else { plane1Segments = segs; plane1BookName = (await resolveWorldMemoriesBook())?.name || null; }
    }
```
Include in the returned `payload`: `plane1Segments` (with each `filteredScene` already carrying its segment sub-range metadata + `characterFilter`), `plane1BookName`, and `plane1: plane1Skipped ? { skipped:true } : undefined`. (Keep `payload.compiledScene` for metadata/back-compat or drop it — it is no longer the AI input.)

- [ ] **Step 2: `executeQueuedMemoryJob`** — early no-op `if (payload.plane1?.skipped) { jobContext.patch({ state: 'skipped', detail: 'Skipped: nothing witnessed' }); return; }`. Then, when `payload.plane1Segments`, replace the single generate+save block with a loop **inside ONE `withStmbWriteLane`** keyed on the effective book name:
```javascript
    const bookName = payload.plane1BookName || lorebookName;
    const entryTitles = [];
    await withStmbWriteLane({ type: 'lorebook', name: bookName }, async () => {
      const data = await loadWorldInfo(bookName);
      if (!data?.entries) throw new Error(`Lorebook "${bookName}" could not be loaded.`);
      const lv = { valid: true, name: bookName, data };
      // overlap check ONCE on the whole scene range (existing findOverlappingMemoryInLorebook):
      if (!settings.moduleSettings?.allowSceneOverlap) { /* check sceneData range once; throw StmbJobNeedsReview if overlap */ }
      for (const seg of payload.plane1Segments) {
        jobContext.throwIfCancelled();
        const mr = await createMemory(seg.filteredScene, profileSettings, { tokenWarningThreshold: payload.tokenThreshold, signal: jobContext.signal });
        mr.characterFilter = seg.characterFilter;
        // mr.metadata.sceneRange already set per-segment by computePlane1Segments' filteredScene.metadata? No —
        //   set it explicitly: mr.metadata.sceneRange = `${seg.filteredScene.metadata.sceneStart}-${seg.filteredScene.metadata.sceneEnd}`;
        const addResult = await addMemoryToLorebook(mr, lv, { autoHide: false, refreshEditor: false, updateHighestMemoryProcessed: false });
        if (!addResult?.success) throw new Error(addResult?.error || 'Failed to add memory to lorebook');
        entryTitles.push(addResult.entryTitle);
      }
    });
    // ---- per-scene-once (after the lane) ----
    await applyQueuedMemoryAutoHide(job, { metadata: { sceneRange: `${sceneData.sceneStart}-${sceneData.sceneEnd}` } }, settings);
    await updateHighestMemoryProcessedForChatRef(job.chatRef, sceneData.sceneEnd);   // already scene-end → unchanged
    jobContext.setResult({ /* lorebookName: bookName, entryTitles, count: entryTitles.length */ });
    // then runAfterMemory / clearAutoSummaryState / maybePromptSelectedAutoConsolidation ONCE (already outside the write block today)
```
> Implementer notes: (1) Auto-accept previews when segmented — for the queued path, when `payload.plane1Segments.length > 1` skip `awaitStmbJobApproval`; when ==1 keep the existing approval flow (preserving `characterFilter`). (2) Do NOT nest `withStmbWriteLane` (deadlock) — all N writes go inside the ONE lane call shown. (3) `applyQueuedMemoryAutoHide` must receive a whole-scene `sceneRange` (not a segment's). (4) Match actual local names (`profileSettings`, `sceneData`, `lorebookName`, `withStmbWriteLane`, `loadWorldInfo`).

- [ ] **Step 3: Verify** — `node --check index.js`; `node --test tests/` → 0 fail; pre-commit build succeeds; re-read flag-off path (when `!isTwoPlane()`, `payload.plane1Segments` is undefined → the original single-entry queued path runs unchanged).

- [ ] **Step 4: Commit** — `git add index.js && git commit -m "feat(memory): queued one-job→N-segment writes in a single write-lane (Phase 1b)"`

---

## Self-Review

- **Spec coverage:** segmenter (T1) → U4/U5/E9 + single-perceiver-drop + unstamped-failopen + homogeneous-1-segment + dead-filter all tested against `computePlane1Segments`. Multi-entry write (T2 auto-hide-once + per-segment STMB range). Non-queued loop (T3) + queued loop (T4) with per-scene-once invariant. Preview = auto-accept-when-segmented (T3/T4). JSON-repair unchanged (single-segment per the captured failing segment).
- **Flag-off byte-identity:** two-plane is an early-return branch in both seams; the flag-off path is the de-interleaved original. T3/T4 each re-read and confirm.
- **Per-scene-once invariant:** auto-hide (`applySceneAutoHide` / `applyQueuedMemoryAutoHide` with whole range), high-water (scene end), after-memory/consolidation/toast all run once after the loop — verified by review (no node test for the live wiring; covered by `computePlane1Segments` tests + manual smoke).
- **Known carry / deferred:** the SHELL for whispers/narrowed audiences (non-witnesses learn "something happened") is **Phase 2** — 1b correctly drops it from non-witnesses. A mocked-ST node integration test for the multi-entry wiring remains deferred (as in 1a). Optional `skipSave` write optimization (N saves → 1) deferred; not needed for correctness.
- **Type consistency:** `computePlane1Segments` returns `{filteredScene, characterFilter, audience, sceneStart, sceneEnd, segmentIndex}`; consumed identically in T3/T4. `characterFilter` shape + fail-open(null)/fail-closed(names:[]) identical to 1a.
