# Diff-doc — Subjective Scheme B format guide for side-prompt trackers

**Status:** PROPOSED — awaiting go.
**Date:** 2026-06-21
**Option chosen by user:** A (central injection in `sidePrompts.buildPrompt`).

## Why

The Plane-2 trackers (`relationship-tracker`, `world-tracker`, `epistemic-tracker`)
receive the **raw, witness-filtered chat** via `buildPrompt` →
`toReadableText(compiledScene)`, which emits each message verbatim as
`[id] name: <raw mes>` — i.e. full Scheme B prose with every marker intact:
`"quotes"`, `> blockquote`, `*italics*`, `(parens)`.

But the side-prompt path injects **no format guide** (verified: `buildPrompt`
assembles only `templatePrompt + prior + previous + additional + sceneText +
responseFormat`). So the trackers are guessing how to read the prose — relationship/
world have zero guidance, epistemic has a one-liner.

## Why not reuse the summarizer's `SCENE_FORMAT_GUIDE`

The summarizer guide is **objective** → it `SKIP`s **all** `*italics*` (private
thought has no place in an audience-neutral memory). The trackers are **subjective
per-`{{char}}`**, and `{{char}}`'s own thoughts are *exactly* the source of
beliefs/mood/secrets. So the italics rule must **flip**: keep `{{char}}`'s own
italics, treat other characters' italics as unperceived. One generic subjective
block is correct for all three trackers.

## The block (new constant in `sidePrompts.js`)

```js
// Two-plane subjective scene-format guide (Scheme B). Injected before the scene
// text so trackers parse raw prose from {{char}}'s perception. Unlike the OBJECTIVE
// summarizer guide (which skips ALL italics), this KEEPS {{char}}'s own italic
// thoughts (source of beliefs/mood/secrets) and treats OTHER characters' italics as
// unperceived.
const SUBJECTIVE_SCENE_FORMAT =
    '## Scene Format (Scheme B) — read the raw chat correctly\n' +
    '- "quotes" = spoken aloud — heard by everyone present.\n' +
    '- > blockquote = remote/written (text, call, DM, letter). {{char}} perceives it ONLY if {{char}} sent or received it. Record it as texted/wrote, not as in-room speech.\n' +
    '- *italics* = a character\'s private unspoken thought:\n' +
    '    - {{char}}\'s OWN -> {{char}}\'s real inner truth — USE it (what {{char}} feels / believes / intends / hides).\n' +
    '    - ANOTHER character\'s -> invisible to {{char}} — NEVER record as something {{char}} knows. At most {{char}} may suspect it from an outward tell.\n' +
    '- (parentheses) = narrator aside — ignore; no one perceives it.\n' +
    '- plain prose = actions / behaviour — observable to those present.\n\n';
```

## The injection (in `buildPrompt`, ~line 805–809)

```diff
     appendSidePromptAdditionalContext(parts, additionalContextEntries);
     // Derive scene text from the compiled scene here to keep a single source of truth
     const sceneText = compiledScene ? toReadableText(compiledScene) : '';
+    // Two-plane: tell the tracker how to read raw Scheme B prose from a SUBJECTIVE
+    // per-{{char}} stance. Routed through applySidePromptMacros so {{char}} (per-character
+    // override) and {{user}} (substituteParamsExtended) resolve EXACTLY like the template.
+    // Gated behind twoPlaneMemory → flag-off is byte-identical to today.
+    if (extension_settings?.STMemoryBooks?.moduleSettings?.twoPlaneMemory) {
+        parts.push('\n');
+        parts.push(applySidePromptMacros(SUBJECTIVE_SCENE_FORMAT, runtimeMacros));
+    }
     parts.push('\n=== SCENE TEXT ===\n');
     parts.push(sceneText);
```

## Placement rationale

Immediately **before `=== SCENE TEXT ===`** — the rule sits adjacent to the raw
data it governs ("here is how to read what follows"). Matches the summarizer intent
without burying the rule among the template's own multi-section instructions.

## Macro resolution (verified)

`applySidePromptMacros(text, runtimeMacros)` (sidePromptMacros.js:55):
1. direct-replaces `runtimeMacros` tokens — for per-character trackers this includes
   `{{char}}` → the actor's name (`buildPerCharacterMacros`, sidePrompts.js:367–372);
2. then `substituteParamsExtended` resolves standard ST macros incl. `{{user}}`.
So both placeholders resolve identically to the template prompt. ✅

## Scope / impact

- Gated by `moduleSettings.twoPlaneMemory`. Flag-OFF → no change (byte-identical).
- Flag-ON → injected into **every** side-prompt's compiled prompt. Currently the only
  enabled side-prompts are the 3 trackers (all `perCharacter`), so in practice this is
  trackers-only. Future per-character trackers inherit it automatically (the DRY win).
- No data change to `stmb-side-prompts.json`. No tracker template edited.

## Test

Add a focused unit test for the branch (host `node --test`):
- `buildPrompt(..)` with `extension_settings.STMemoryBooks.moduleSettings.twoPlaneMemory = true`
  → output contains `Scene Format (Scheme B)` and the flipped-italics line.
- same with the flag false → output does NOT contain it (byte-identical assertion on
  the assembled string minus the block).

## Build + reload

1. Edit `sidePrompts.js` (constant + injection).
2. Pre-commit hook runs `bun run build.ts` → `index.build.js` (or run build manually).
3. **Hard-reload ST** (browser caches `index.build.js`).
4. Run a tracker (`/sideprompt` or `/nextmemory`) and confirm the block appears in the
   `[STMB-PROMPT]` debug output and that epistemic correctly routes own-thought →
   Knows/Believes, others'-thought → Suspects/absent.

## Rollback

Single `if` block + one constant. Remove both, rebuild, reload. Or set
`twoPlaneMemory=false` (disables this *and* all other two-plane behavior — not a
targeted rollback, but instant).
