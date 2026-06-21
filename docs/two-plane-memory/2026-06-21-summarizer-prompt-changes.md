# STMB Summarizer Prompt Changes — Diff Doc (for approval before apply)

**Status:** PROPOSED — no code edited yet. Apply only after sign-off (doc-first rule).

**Goal:** Align the STMB leaf-memory summarizer with the two-plane goals — an OBJECTIVE, audience-neutral, scene-scoped record that's correct for both group and solo chats — without duplicating StateTracker's texting rule and without pulling per-character POV into Plane-1.

**Decisions locked (user):**
- Schema B = an INPUT-PARSING guide (how the summarizer reads the chat), stays objective. ✔ keep `SCENE_FORMAT_GUIDE`.
- POV / "perceived knowledge only" → Plane-2 (per-character subjective layer); NOT added to Plane-1 objective summaries. `PERSPECTIVE_RULE` stays auto-disabled in two-plane (unchanged).
- Texting rule stays StateTracker's (lorebook `⚙️ State Tracker - Core Tier 3` → 'Remote / Texting'); STMB adds only a **parsing** note for `>` (how to READ it), not the generation rule.
- New summary preset delivered as a **built-in preset** (version-controlled), light-structure-lean.
- Arc/chapter rollup prompts: **unchanged** (they roll up already-parsed objective summaries, carry no `{{char}}`, and Phase 3 gates their audience).

---

## Change 1 — `SCENE_FORMAT_GUIDE`: add the `>` parsing line

**File:** `stmemory.js` (~line 1430, inside `buildPrompt`)

This guide is prepended to EVERY extraction. It currently classifies `"quotes"`, `*italics*`, `(parens)`, and plain prose, but has no rule for `>` blockquotes — and the summarizer never receives StateTracker's texting rule (that's injected into main generation only). Adding a one-line *parsing* note (how to read/phrase `>`), not the generation rule.

```diff
         '## Scene Format Guide (Scheme B)\n' +
         '- "quotes" = spoken dialogue — INCLUDE: audible to characters present.\n' +
+        '- > blockquote = remote/written exchange (text, call, DM, letter) — INCLUDE, but record it as such (e.g. "texted"/"wrote"), not as speech in the room.\n' +
         '- *italics* = private unspoken thought — SKIP: invisible to all other characters.\n' +
         '- (parentheses) = narrator aside — SKIP: reader-only, no character perceives it.\n' +
         '- Plain prose = actions and behavior. Apply the rules below.\n' +
```

Why this isn't duplication: StateTracker's 'Remote / Texting' rule governs how a CHARACTER *writes* a text during generation. This line governs how the SUMMARIZER *reads* an existing `>` line. Different concern, no shared source of truth to drift from.

---

## Change 2 — New built-in preset `witness`

**File:** `utils.js`, `getBuiltInPresetPrompts()` (~line 845). Add after the `comprehensive` entry (insert a comma after the comprehensive `translate(...)` close, then this entry, before the closing `};`):

```js
        ,
        witness: translate(
`Analyze the roleplay scene below and return an OBJECTIVE memory of it as JSON.

Respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (3-5 words)",
  "content": "Objective, audience-neutral record of this scene (structure below)",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

CONTENT — an objective, third-person, past-tense record of THIS scene only:
- Cover what every present character did and said; name them. Do NOT write from any single character's point of view or privilege one character's perspective.
- Record ONLY what is shown in the messages provided. Do NOT add, infer, or carry in events, knowledge, or backstory not present in this scene.
- Token-efficient: synthesize, don't transcribe. Favor cause -> intention -> reaction -> consequence. Concrete nouns; adjectives/adverbs only when they change meaning or tone.
- Exclude all [OOC]/meta.
Use this lean structure inside the content string (omit a section if it is empty):
**Timeline**: in-story day/time span covered.
**Beats**: 3-7 bullets — major actions, revelations, turning points, in order.
**Dynamics**: 1-2 bullets — relationship/emotional shifts that were OUTWARDLY expressed (observable only; no inner interpretation).
**Key Exchanges**: up to 3 short exact quotes, attributed by name, only if pivotal.
**Outcome & Continuity**: decisions, promises, unresolved threads, physical outcomes, anything that affects future scenes.

KEYWORDS — 15-30 standalone retrieval tags:
- Concrete and scene-specific (locations, objects, proper nouns, distinctive actions, repeated motifs); one concept per keyword. A keyword should fire when its noun/action is mentioned alone.
- NOT character or user names. NOT thematic/emotional/abstract. Stop-list: intimacy, vulnerability, trust, dominance, submission, power dynamics, boundaries, jealousy, aftercare, longing, consent, emotional connection.

Return ONLY the JSON, no other text.`,
            'STMemoryBooks_Prompt_witness'
        )
```

Design notes:
- **Objective + audience-neutral** ("every present character", "do NOT privilege one character's perspective", no `{{user}}`/`{{char}}` dyad) → fixes the group bug AND works for solo (collapses to the one character) in a single framing.
- **Scene-scoped** ("record ONLY what is shown… do NOT add/infer/carry in") → the objective form of "perceived knowledge only"; complements two-plane input-filtering, no POV.
- **Light-structure-lean** → `**bold**` inline labels (not `##` headers), same section names as the arc prompt (Timeline / Beats / Dynamics / Outcome & Continuity) so leaf→arc rollups stay consistent.
- **Dynamics guarded** to "outwardly expressed (observable only; no inner interpretation)" → keeps it Plane-1, no Plane-2 bleed.
- **Keyword spec** distilled from the well-tuned `comprehensive` preset.
- Schema B parsing (dialogue/thought/narration/`>`) is handled by the prepended `SCENE_FORMAT_GUIDE`, so this preset does not repeat it.

---

## Change 3 — Register the preset key

**File:** `utils.js`, `getPresetNames()` (line 1014):
```diff
-    return ['summary', 'summarize', 'synopsis', 'sumup', 'minimal', 'northgate', 'aelemar', 'comprehensive'];
+    return ['summary', 'summarize', 'synopsis', 'sumup', 'minimal', 'northgate', 'aelemar', 'comprehensive', 'witness'];
```

**File:** `utils.js`, `isValidPreset()` (line 1023):
```diff
-    const builtIns = new Set(['summary', 'summarize', 'synopsis', 'sumup', 'minimal', 'northgate', 'aelemar', 'comprehensive']);
+    const builtIns = new Set(['summary', 'summarize', 'synopsis', 'sumup', 'minimal', 'northgate', 'aelemar', 'comprehensive', 'witness']);
```

(The dropdown via `summaryPromptManager.listPresets()` iterates `getBuiltInPresetPrompts()` keys, so Change 2 already surfaces it; these two keep the explicit list/validation in sync.)

---

## Change 4 — Display name

**File:** `constants.js`, `DISPLAY_NAME_DEFAULTS`:
```diff
     comprehensive: 'Comprehensive - Synopsis plus improved keywords extraction',
+    witness: 'Witness - Objective, audience-neutral scene log (light structure; for two-plane)',
 };
```

**File:** `constants.js`, `DISPLAY_NAME_I18N_KEYS`:
```diff
     comprehensive: 'STMemoryBooks_DisplayName_comprehensive',
+    witness: 'STMemoryBooks_DisplayName_witness',
 };
```

(i18n is optional: `translate(defaultText, key)` falls back to the inline English when the locale key is absent, so no `locales.js` edit is required. Can add `STMemoryBooks_Prompt_witness` / `STMemoryBooks_DisplayName_witness` to `locales.js` later for localization.)

---

## NOT changed
- Arc/chapter/rollup prompts (`templatesArcPrompts.js`) — objective, no `{{char}}`, Phase 3 handles audience.
- `PERSPECTIVE_RULE` — stays, stays auto-disabled in two-plane.
- The other 8 presets — left intact (users who selected them keep them).
- StateTracker — untouched.

## Verification
1. `grep -c '\x00' …` n/a; `node --test tests/` — confirm green; if any test asserts the built-in preset count/list (e.g. `getPresetNames().length === 8`), update it to include `witness`.
2. `bun run build.ts` — succeeds, `index.build.js` regenerated.
3. Manual: STMB profile → preset dropdown shows "Witness …"; select it; `/nextmemory` → memory content uses the new structure.

## After apply (user action)
Adding a preset does NOT change the active profile. After ST reload, **select the "Witness" preset** in the STMB profile you use for TWW2 for it to take effect.
