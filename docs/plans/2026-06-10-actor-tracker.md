# Actor Tracker (witness-scoped per-character side prompts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-character side prompts (the user's "Context Tracker Trimmed" → "Actor Tracker") run only for actors present in the last N messages, feed each actor only the messages they witnessed, and inject each actor's tracker entry only into that actor's own drafts.

**Architecture:** Three opt-in per-template settings (`presenceGate`, `witnessFilter`, `injectOnlyForCharacter`), all default-off for back-compat. A new pure module `witnessScope.js` (no ST imports, Node-testable) reads the `extra.channel.audience` stamps that SillyTavern-StateTracker writes on every message (FAIL-OPEN contract: unstamped message = witnessed by everyone — identical semantics to Smart-Memory's `witness.js`). Wiring touches only `sidePrompts.js` (gate + filter in both the onInterval and manual paths) and passes a `characterFilter` through the **existing** `entryOverrides` option of `upsertLorebookEntryByTitle` (zero changes to `addlore.js`). Popup UI gets three controls cloned from the existing `perCharacter` checkbox pattern.

**Tech Stack:** Plain ES modules, `node --test` (new dev-only test script; no new dependencies). Repo is bind-mounted into the `sillytavern` container — a browser reload serves changes.

**Branch:** `actor-tracker` off `main`.

---

## File Structure

| File | Change |
|---|---|
| `witnessScope.js` | **Create.** Pure helpers: `audienceOf`, `messageWitnessedBy`, `isPresentInWindow`, `filterCompiledSceneForCharacter`. No imports. |
| `tests/witnessScope.test.js` | **Create.** Unit tests for the pure module. |
| `sidePrompts.js` | **Modify.** Presence gate after both `discoverChatCharacters()` call sites (~line 1152 interval, ~line 1722 manual); per-character witness filter inside both work-item loops (~line 1163, ~line 1741); `entryOverrides` at the 4 upsert call sites (lines ~1275, ~1290, ~1850, ~1867) via one new helper. |
| `sidePromptsPopup.js` | **Modify.** Three new controls in the edit dialog (pattern at lines 309/311/476/648) and the new-template dialog (line ~1007). |
| `package.json` | **Modify.** Add `"test": "node --test tests/"` script. |

Key facts the implementer must NOT rediscover wrong:
- `compileScene()` (chatcompile.js:52) emits compiled messages carrying `id` = the chat array index. The witness filter joins `compiledMessage.id` → `chat[id].extra.channel.audience`. Do NOT modify chatcompile.js.
- `upsertLorebookEntryByTitle(lorebookName, lorebookData, title, content, options)` already applies `options.entryOverrides` generically (`entry[k] = v`) on create AND update (addlore.js). Do NOT modify addlore.js.
- Audience stamps are lowercase names (e.g. `["sachin","shilpa","kavya nair"]`) including remote (texting) participants. Compare with `charTarget.name.toLowerCase()`.
- `tpl.settings` is persisted as-is by sidePromptsManager (no settings whitelist; only `triggers` are normalized) — new keys survive save/load.

---

### Task 1: Branch + test infra

**Files:** Modify: `package.json`

- [ ] **Step 1.1:** `cd /ssd/Workspace/Projects/SillyTavern-Extensions/SillyTavern-MemoryBooks && git checkout main && git checkout -b actor-tracker`
- [ ] **Step 1.2:** In `package.json` `scripts`, add (keep existing scripts):

```json
"test": "node --test tests/"
```

- [ ] **Step 1.3:** `mkdir -p tests && npm test` — Expected: exits 0 with `# tests 0` (or "no test files" notice; both fine).
- [ ] **Step 1.4 Commit:** `git add package.json && git commit -m "chore: node:test infra for actor-tracker work"`

---

### Task 2: `witnessScope.js` pure module (TDD)

**Files:** Create: `witnessScope.js`, Test: `tests/witnessScope.test.js`

- [ ] **Step 2.1: Write the failing tests** — `tests/witnessScope.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    audienceOf, messageWitnessedBy, isPresentInWindow, filterCompiledSceneForCharacter,
} from '../witnessScope.js';

const stamped = (aud, name = 'Shilpa', extra = {}) => ({
    name, mes: 'x', extra: { channel: { audience: aud } }, ...extra,
});
const unstamped = (name = 'Shilpa', extra = {}) => ({ name, mes: 'x', ...extra });

test('audienceOf returns lowercase array for stamped, null for unstamped', () => {
    assert.deepEqual(audienceOf(stamped(['Sachin', 'KAVYA NAIR'])), ['sachin', 'kavya nair']);
    assert.equal(audienceOf(unstamped()), null);
    assert.equal(audienceOf(null), null);
});

test('messageWitnessedBy: in-audience true, out false, unstamped fail-open true', () => {
    assert.equal(messageWitnessedBy(stamped(['sachin', 'kavya nair']), 'Kavya Nair'), true);
    assert.equal(messageWitnessedBy(stamped(['sachin', 'kavya nair']), 'Aisha'), false);
    assert.equal(messageWitnessedBy(unstamped(), 'Aisha'), true);
});

test('isPresentInWindow: via audience stamp', () => {
    const chat = [stamped(['sachin', 'aisha'], 'Aisha')];
    assert.equal(isPresentInWindow('Aisha', chat, 0, 0), true);
    assert.equal(isPresentInWindow('Meera', chat, 0, 0), false);
});

test('isPresentInWindow: via authored bubble (remote-texting fallback, no stamp)', () => {
    const chat = [unstamped('Kavya Nair')];
    assert.equal(isPresentInWindow('kavya nair', chat, 0, 0), true);
});

test('isPresentInWindow: is_system skipped; user bubbles do not qualify a char; window bounds respected', () => {
    const chat = [
        stamped(['sachin', 'meera'], 'Meera', { is_system: true }), // hidden
        unstamped('Sachin', { is_user: true }),
        stamped(['sachin', 'shilpa'], 'Shilpa'),
    ];
    assert.equal(isPresentInWindow('Meera', chat, 0, 2), false);   // only hidden msg
    assert.equal(isPresentInWindow('Sachin', chat, 1, 1), false);  // user bubble, is_user
    assert.equal(isPresentInWindow('Shilpa', chat, 0, 1), false);  // outside window
    assert.equal(isPresentInWindow('Shilpa', chat, 0, 2), true);
});

test('filterCompiledSceneForCharacter joins by id, fail-open, updates metadata', () => {
    const chat = [
        stamped(['sachin', 'kavya nair'], 'Kavya Nair'), // 0: private — Aisha NOT witness
        unstamped('Sachin', { is_user: true }),          // 1: untagged — fail-open, kept
        stamped(['sachin', 'aisha'], 'Aisha'),           // 2: Aisha witness
    ];
    const compiled = {
        metadata: { messageCount: 3 },
        messages: [
            { id: 0, name: 'Kavya Nair', mes: 'secret' },
            { id: 1, name: 'Sachin', mes: 'hello' },
            { id: 2, name: 'Aisha', mes: 'hey' },
        ],
    };
    const out = filterCompiledSceneForCharacter(compiled, chat, 'Aisha');
    assert.deepEqual(out.messages.map(m => m.id), [1, 2]);
    assert.equal(out.metadata.messageCount, 2);
    assert.equal(out.metadata.witnessFiltered, 1);
    // input untouched
    assert.equal(compiled.messages.length, 3);
});
```

- [ ] **Step 2.2:** `npm test` — Expected: FAIL, `Cannot find module .../witnessScope.js`.
- [ ] **Step 2.3: Implement** — `witnessScope.js`:

```js
/**
 * Witness scoping for per-character side prompts (actor tracker).
 * PURE module — no SillyTavern imports; callers pass the live chat array.
 *
 * audience = lowercase perceiver names stamped by SillyTavern-StateTracker on
 * msg.extra.channel.audience (includes remote/texting participants). Contract
 * is FAIL-OPEN: a message with no stamp is witnessed by everyone — identical
 * semantics to Smart-Memory's witness.js, so all three extensions agree.
 */

/** Lowercased audience array for a message, or null when unstamped. */
export function audienceOf(message) {
    const aud = message?.extra?.channel?.audience;
    return Array.isArray(aud) ? aud.map(n => String(n).toLowerCase()) : null;
}

/** True when charName witnessed the message (fail-open on unstamped). */
export function messageWitnessedBy(message, charName) {
    const aud = audienceOf(message);
    if (!aud) return true;
    return aud.includes(String(charName || '').trim().toLowerCase());
}

/**
 * Presence gate: is charName present in chat[start..end]?
 * Present = named in any non-system message's audience stamp (covers remote/
 * texting participants), OR authored a non-system, non-user bubble in the
 * window (fallback that also works in chats without StateTracker stamps).
 */
export function isPresentInWindow(charName, chat, start, end) {
    const target = String(charName || '').trim().toLowerCase();
    if (!target || !Array.isArray(chat)) return false;
    const lo = Math.max(0, start | 0);
    const hi = Math.min(chat.length - 1, end | 0);
    for (let i = lo; i <= hi; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const aud = audienceOf(m);
        if (aud && aud.includes(target)) return true;
        if (!m.is_user && String(m.name || '').trim().toLowerCase() === target) return true;
    }
    return false;
}

/**
 * Return a NEW compiledScene containing only messages charName witnessed.
 * compiledMessage.id is the chat index (set by compileScene) — used to join
 * back to the live message for its stamp. metadata.messageCount is updated;
 * metadata.witnessFiltered records how many messages were dropped.
 */
export function filterCompiledSceneForCharacter(compiledScene, chat, charName) {
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => messageWitnessedBy(chat?.[cm.id], charName));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            witnessFiltered: all.length - messages.length,
        },
    };
}
```

- [ ] **Step 2.4:** `npm test` — Expected: all witnessScope tests PASS.
- [ ] **Step 2.5:** `node --check witnessScope.js`
- [ ] **Step 2.6 Commit:** `git add witnessScope.js tests/ && git commit -m "feat: witnessScope pure module (presence gate + witness filter, fail-open)"`

---

### Task 3: Presence gate in both side-prompt paths

**Files:** Modify: `sidePrompts.js` (import block ~line 20; interval path ~line 1152; manual path ~line 1722)

- [ ] **Step 3.1:** Add import near the other local imports at the top of `sidePrompts.js`:

```js
import { isPresentInWindow, filterCompiledSceneForCharacter } from './witnessScope.js';
```

- [ ] **Step 3.2 (interval path):** in the `onInterval` loop, immediately after `const rawChars = discoverChatCharacters();` (line ~1152), insert (note `threshold` and `currentLast` are in scope; `chat` is already imported from script.js):

```js
let gatedChars = rawChars;
if (tpl?.settings?.presenceGate?.enabled) {
    const win = Math.max(1, Number(tpl.settings.presenceGate.lastNMessages ?? threshold));
    const gateStart = Math.max(0, currentLast - win + 1);
    gatedChars = rawChars.filter(c => isPresentInWindow(c.name, chat, gateStart, currentLast));
    console.log(`${MODULE_NAME}: presenceGate "${tpl.name}" kept ${gatedChars.length}/${rawChars.length} characters (window ${gateStart}-${currentLast}): ${gatedChars.map(c => c.name).join(', ') || '(none)'}`);
    if (gatedChars.length === 0) continue; // nobody present — skip template this tick
}
charWorkItems = await resolveAllPerCharacterLorebooks(gatedChars, tplLores[0]);
```

(replacing the existing `charWorkItems = await resolveAllPerCharacterLorebooks(rawChars, tplLores[0]);` — keep the surrounding `rawChars.length === 0` early-skip above it).

- [ ] **Step 3.3 (manual path):** same change after the manual path's `discoverChatCharacters()` (~line 1722). The manual path's window: it compiled either an explicit `start–end` range or `autoStart..currentLast` — reuse those exact bounds for the gate (the variables are in scope where `compiled` was built; thread them down if needed via consts `gateStart`/`gateEnd` captured at compile time). In the manual path, on 0 kept, `toastr.info` + `return ''` instead of `continue`.
- [ ] **Step 3.4:** `node --check sidePrompts.js` && `npm test` (still green — gate is live-only code).
- [ ] **Step 3.5 Commit:** `git commit -am "feat(sideprompts): presenceGate — per-character runs only for actors present in last N messages"`

---

### Task 4: Witness-filtered window per character

**Files:** Modify: `sidePrompts.js` (interval loop ~line 1170; manual loop ~line 1746)

- [ ] **Step 4.1:** In BOTH per-character work-item loops, immediately before `prepareSidePromptRun({...})`, insert:

```js
let perCharCompiled = compiled;
if (charTarget && tpl?.settings?.witnessFilter?.enabled) {
    perCharCompiled = filterCompiledSceneForCharacter(compiled, chat, charTarget.name);
    if (perCharCompiled.messages.length === 0) {
        console.log(`${MODULE_NAME}: witnessFilter left 0 messages for ${charTarget.name}; skipping`);
        continue;
    }
    if (perCharCompiled.metadata.witnessFiltered > 0) {
        console.log(`${MODULE_NAME}: witnessFilter dropped ${perCharCompiled.metadata.witnessFiltered} message(s) for ${charTarget.name}`);
    }
}
```

and change `compiledScene: compiled,` → `compiledScene: perCharCompiled,` in that loop's `prepareSidePromptRun` call.

- [ ] **Step 4.2:** `node --check sidePrompts.js && npm test` — green.
- [ ] **Step 4.3 Commit:** `git commit -am "feat(sideprompts): witnessFilter — each actor's window contains only messages they witnessed (fail-open)"`

---

### Task 5: Inject-only-for-character (characterFilter on upsert)

**Files:** Modify: `sidePrompts.js` (helper + 4 upsert call sites: lines ~1275, ~1290, ~1850, ~1867)

- [ ] **Step 5.1: Verify the ST field name** (do not skip):

```bash
docker exec sillytavern sh -c "grep -n 'characterFilter' /home/node/app/public/scripts/world-info.js | head -5"
```

Expected: hits showing `characterFilter` with `isExclude`/`names` usage. If the field differs in this ST build, adapt the helper below to the real schema and note it in the commit message.

- [ ] **Step 5.2:** Add helper near `buildPerCharacterMacros` in `sidePrompts.js`:

```js
/**
 * Per-character injection scoping: when the template opts in, the upserted
 * entry gets a WI characterFilter so it only activates for that character's
 * own drafts — other group members never see this actor's private tracker.
 */
function sidePromptEntryOverrides(tpl, charTarget) {
    if (!charTarget?.name || !tpl?.settings?.injectOnlyForCharacter?.enabled) return {};
    return { characterFilter: { isExclude: false, names: [charTarget.name], tags: [] } };
}
```

- [ ] **Step 5.3:** At each of the 4 `upsertLorebookEntryByTitle(...)` call sites, add to the options object (merging with any existing `entryOverrides` key — as of `main` none of the 4 passes one):

```js
entryOverrides: sidePromptEntryOverrides(tpl, charTarget),
```

(The two non-per-character call sites have `charTarget = null` in scope → helper returns `{}` → no behavior change.)

- [ ] **Step 5.4:** `node --check sidePrompts.js && npm test` — green.
- [ ] **Step 5.5 Commit:** `git commit -am "feat(sideprompts): injectOnlyForCharacter — per-actor tracker entries inject only on that actor's drafts"`

---

### Task 6: Popup UI for the three settings

**Files:** Modify: `sidePromptsPopup.js` (edit dialog: read state ~line 309, html ~line 311–476, save ~line 648; new dialog: save ~line 1007 and its html block)

- [ ] **Step 6.1:** In the EDIT dialog, next to the existing `perCharacter` checkbox block (pattern at lines 309–314), add three controls following the same html/id conventions:
  - `stmb-sp-edit-presence-gate` (checkbox, label "Only for actors present in last N messages")
  - `stmb-sp-edit-presence-window` (number input, min 1, placeholder "N (default: interval)", value from `s.presenceGate?.lastNMessages ?? ''`)
  - `stmb-sp-edit-witness-filter` (checkbox, label "Witness-filter the window per actor")
  - `stmb-sp-edit-inject-only-char` (checkbox, label "Inject entry only for this actor's drafts")
  Initialize from `s.presenceGate?.enabled`, `s.witnessFilter?.enabled`, `s.injectOnlyForCharacter?.enabled`.
- [ ] **Step 6.2:** In the edit-dialog save handler (~line 648, next to `settings.perCharacter = ...`):

```js
const pgEnabled = !!dlg.querySelector('#stmb-sp-edit-presence-gate')?.checked;
const pgN = parseInt(dlg.querySelector('#stmb-sp-edit-presence-window')?.value, 10);
settings.presenceGate = { enabled: pgEnabled, ...(Number.isFinite(pgN) && pgN > 0 ? { lastNMessages: pgN } : {}) };
settings.witnessFilter = { enabled: !!dlg.querySelector('#stmb-sp-edit-witness-filter')?.checked };
settings.injectOnlyForCharacter = { enabled: !!dlg.querySelector('#stmb-sp-edit-inject-only-char')?.checked };
```

- [ ] **Step 6.3:** Mirror both steps in the NEW-template dialog (`stmb-sp-new-*` ids, save at ~line 1007).
- [ ] **Step 6.4:** `node --check sidePromptsPopup.js && npm test`.
- [ ] **Step 6.5 Commit:** `git commit -am "feat(sideprompts-ui): presenceGate / witnessFilter / injectOnlyForCharacter controls"`

---

### Task 7: Live verification (bind-mount; browser reload serves the branch)

No code. Checklist (drive via real UI; verify via console logs — `[STMemoryBooks-SidePrompts]` lines):

- [ ] 7.1 Reload ST browser. In STMB side-prompts popup, clone "Context Tracker Trimmed" → **"Actor Tracker"**: enable all three new settings, set presence window (e.g. 20), set `overrideProfile` to the DeepSeek profile (create one in STMB profiles UI if only "Current SillyTavern Settings" exists — nanogpt also routes deepseek models). DELETE the "ignore anything that happened while {{char}} was absent" line from the prompt (now structural). Disable the old "Context Tracker Trimmed" template (or scope it out) so both don't run.
- [ ] 7.2 In TWW2 test chat: drive a 2-actor scene past the interval → console shows `presenceGate "Actor Tracker" kept 2/19` and per-actor `witnessFilter dropped N message(s)` where private messages exist; only 2 SidePrompt attempts fire (was 19).
- [ ] 7.3 Inspect the two upserted entries in the lorebook editor: content updated AND `characterFilter.names == [that character]`.
- [ ] 7.4 The characterFilter live test: with Kavya's tracker entry present, draft AISHA and check the WI activation log (`[WI] Adding N entries`/WorldInfoInfo panel) — Kavya's tracker entry must NOT activate; draft KAVYA — it must. If group drafts do NOT honor characterFilter per-speaker, log the finding and fall back to disabling `injectOnlyForCharacter` (documented limitation).
- [ ] 7.5 Solo-chat regression: any existing single-char side prompt still runs (gate/filter default-off on old templates).

---

## Self-review notes
- All three settings default OFF → untouched templates behave byte-identically (gate replaces only the array fed to `resolveAllPerCharacterLorebooks`; filter only swaps the `compiledScene` arg; overrides helper returns `{}` unless opted in).
- Fail-open everywhere → chats without StateTracker stamps degrade to author-presence gating + unfiltered windows, never to silent skips.
- `metadata.witnessFiltered` + the `kept X/19` logs make the feature observable in the console (matches the no-silent-caps house rule).
