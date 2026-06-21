# Witness preset v2 + in-story clock injection — Diff Doc (for approval before apply)

**Status:** PROPOSED — no code edited yet. Apply after sign-off (doc-first rule).

**Goal:** Make `witness` the canonical leaf prompt = the user's dual-layer keyword strategy + structure **aligned to the consolidation prompt** + objective/audience-neutral/scene-scoped framing + **day-aware** (real in-story date, no "Day X"). And feed the in-story clock to the summarizer so dates resolve.

**Decisions (user):** enhance the `witness` BUILT-IN (version-controlled; user switches profile to it); **feed `scene.clock` + use the real date**. Consolidation prompt stays as the user's override (untouched) — leaf↔arc consistency achieved by matching the witness leaf's section names to it.

---

## Change 1 — Inject the in-story clock (prompt-agnostic)

**File:** `stmemory.js`, `buildPrompt` (~line 1462, where `finalPrompt` is assembled). `getContext` is already imported (line 7); no new import needed.

The clock lives at `chat_metadata.state_tracker_state.scene.clock` (e.g. `"Saturday, May 24, 2025 — 7:15 PM"`), written by StateTracker. STMB doesn't currently feed it. Add a guarded date line before the scene text:

```diff
     const additionalContext = await resolveAdditionalContextEntries(profile, compiledScene);
     const sceneText = formatSceneForAI(messages, metadata, previousSummariesContext, additionalContext.entries);
 
-    // Combine: Scheme B filter + system prompt + scene
-    const finalPrompt = `${SCHEME_B_FILTER}${processedSystemPrompt}\n\n${sceneText}`;
+    // In-story clock (StateTracker) — feed it so summaries are dated correctly. Guarded: skip if absent.
+    let dateLine = '';
+    try {
+        const stClock = getContext()?.chat_metadata?.state_tracker_state?.scene?.clock;
+        if (typeof stClock === 'string' && stClock.trim()) {
+            dateLine = `IN-STORY DATE/TIME (current scene clock): ${stClock.trim()}\n\n`;
+        }
+    } catch (e) { /* non-fatal: no date line */ }
+
+    // Combine: Scheme B filter + system prompt + in-story date + scene
+    const finalPrompt = `${SCHEME_B_FILTER}${processedSystemPrompt}\n\n${dateLine}${sceneText}`;
```

Prompt-agnostic: every preset that asks for a date can now use it. Flag-independent (it's just extra context; harmless if a preset ignores it). Reads StateTracker's metadata only (same `chat_metadata`), fully guarded.

---

## Change 2 — Replace the `witness` built-in with v2

**File:** `utils.js`, `getBuiltInPresetPrompts()` — replace the existing `witness: translate(\`...\`, 'STMemoryBooks_Prompt_witness')` block (added in 1b6be09) with this:

```
Analyze the roleplay scene below and return an OBJECTIVE memory of it as JSON.

Respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (3-6 words)",
  "content": "Objective, audience-neutral record of this scene (structured; see below)",
  "keywords": ["keyword1", "keyword2"]
}

CONTENT — an objective, third-person, past-tense record of THIS scene only:
- Cover what every present character did and said; name them. Do NOT write from any single character's point of view or privilege one character's perspective.
- Record ONLY what is shown in the messages provided. Do NOT add, infer, or carry in events, knowledge, or backstory not present in this scene.
- Token-efficient: synthesize, don't transcribe. Trace cause -> intention -> reaction -> consequence. Concrete nouns; adjectives/adverbs only when they change meaning or tone. Exclude all [OOC]/meta.
- Use this structure inside the content string (omit a section if it is empty):

# Scene Summary — [in-story date] — [Title]
(Use the IN-STORY DATE/TIME provided with the scene for [in-story date]; if none is provided, write "undated". Never output a placeholder like "Day X".)

## Timeline
- **Period**: [start] -> [end] using the in-story date/time provided (e.g. "Saturday, May 24, 2025, 7:15 PM"); a single moment if the scene is brief.
- Key events in chronological order — "[time/moment]: [event]".

## Major Beats
- 3-7 bullets: plot-changing actions, revelations, turning points, in order; cause -> effect.

## Character Dynamics
- 1-2 short bullets: relationship/emotional shifts that were OUTWARDLY expressed (observable only; no inner interpretation).

## Key Exchanges
- Up to 3 short exact quotes, attributed by name, only if pivotal.

## Outcome & Continuity
- Decisions, promises, unresolved threads, physical outcomes — anything that affects future scenes.

KEYWORDS — 10-20 retrieval tags, DUAL-LAYER (must serve BOTH substring matching against chat messages AND vector/semantic search):

LAYER 1 — SIMPLE TRIGGER WORDS (5-8): short, concrete, 1-2 word terms a character would ACTUALLY TYPE when later referencing this scene (e.g. "date", "roti", "GPS tracker", "parking lot"). Ask: would someone plausibly type this word? OK if a word also appears in 2-3 other entries; avoid words that would match 5+.
LAYER 2 — SIGNATURE PHRASES (5-8): distinctive 2-5 word phrases capturing this scene's unique identity for vector search (e.g. "load-bearing wall metaphor", "kitchen floor reconciliation", "first roti puffs perfectly").
AVOID: character or user names; abstract emotions/themes (intimacy, vulnerability, trust, dominance, submission, power dynamics, boundaries, jealousy, aftercare, longing, consent); generic recurring environment details (mattress, lamplight, living room). Do NOT make all keywords 3+ words — at least half must be 1-2 words.
DEDUP: if PREVIOUS SCENE CONTEXT is provided, do not reuse a keyword already there unless this scene gives it a fundamentally different meaning.

Return ONLY the JSON, no other text.
```

What changed vs the 1b6be09 witness: section structure now mirrors the consolidation prompt (`## Timeline / ## Major Beats / ## Character Dynamics / ## Key Exchanges / ## Outcome & Continuity` under a dated `# Scene Summary` H1), the keyword block is the user's full dual-layer strategy (was a distilled single-layer spec), and the date is resolved from the injected clock (no "Day X"). The objective/audience-neutral/scene-scoped framing is retained.

**Display name** (`constants.js` `DISPLAY_NAME_DEFAULTS.witness`): update to
`'Witness - Objective, audience-neutral, dual-layer keywords, day-aware (two-plane canonical)'`.

---

## Change 3 — Remove the shadowing `witness` override (DATA)

**File:** `sillytavern/data/default-user/user/files/stmb-summary-prompts.json`

There is a `witness` **override** (the old 1b6be09 text) in this user-data file. `getPrompt('witness')` checks overrides first, so the override would **shadow** the enhanced built-in. Back up the file, then delete the `witness` key from `overrides` so the built-in is used. (I'll do this on disk with a backup, or you can "Reset to default" the witness preset in the prompt-manager UI.)

---

## NOT changed
- The consolidation prompt (`Consolidation Prompt v2`) — stays as your override; already two-plane-aligned.
- `SCENE_FORMAT_GUIDE` (already has the `>` line), `PERSPECTIVE_RULE` (stays off in two-plane), the other built-in presets.

## Verification
1. `node --test tests/` — green (no preset-count test exists).
2. `bun run build.ts` — succeeds; `witness` v2 + the date-line literal present in `index.build.js`.
3. After apply + remove-override + ST hard-reload: select **Witness**, `/stmb-set-highest none` (or disk reset), regenerate → entries are **dated** (e.g. "Saturday, May 24, 2025…", no "Day X"), objective, audience-neutral, with dual-layer keywords. The whisper still splits (main {Shilpa,Aisha} + content {Shilpa} + shell {Aisha}).
