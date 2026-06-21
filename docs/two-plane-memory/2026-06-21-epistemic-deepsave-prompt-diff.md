# Diff-doc — Epistemic deep-save prompt + setting (Tasks 1 & 6)

**Status:** APPLIED 2026-06-21 to the live store
`data/default-user/user/files/stmb-side-prompts.json` (`epistemic-tracker`), verified by
structural diff (only `prompt`, `responseFormat`, `settings/deepSave` changed). Backup:
`stmb-side-prompts.json.bak-20260621-deepsave-applied`. Pending: user creates +
vectorizes the cold book + hard-reloads (see below).

Implements Tasks 1 & 6 of `docs/superpowers/plans/2026-06-21-epistemic-deep-save.md`.

## Task 1 — emit `(#N)` + `## To Deep Storage`

**E1 (prompt, rule 2):**
- BEFORE: `2. ONLY the four sections in the Response Format, in order. No prose outside them.`
- AFTER: `2. ONLY the four knowledge sections (Knows, Suspects, Believes, Hiding) plus the transient \`## To Deep Storage\` list, in order. No prose outside them.`

**E2 (prompt, "Keep ACTIVE/hot items only" paragraph):** added the `(#N)` age mechanic
and the age-out→`## To Deep Storage` move rule; Hiding-no-longer-secret is dropped (not
deep-saved); Unaware is not mentioned (already removed earlier).

**E3 (responseFormat):** appended `` `(#N)` `` to the Knows/Suspects/Believes item lines
and added the section:
```
## To Deep Storage
(items leaving hot this run; pipe-delimited; omit the whole section if none)
- knows|believes|suspects | [about whom] | [fact, paraphrased] | resolved|distant
```

## Task 6 — enable deep-save

Added to `epistemic-tracker.settings`:
```json
"deepSave": { "enabled": true, "bookName": "{{group}} - Deep Facts" }
```
This is the flag the wiring (`maybeDeepSave` in `sidePrompts.js`) gates on — until set, the
whole deep-save path was inert.

## Remaining MANUAL steps (user)
1. In ST → World Info, create an empty lorebook named exactly `🏠 TWW2 - Deep Facts`,
   save; enable vectorization for it (Vector Storage extension). (`ensureBook` will create
   it if missing, but pre-creating guarantees ST registers it for retrieval.)
2. Hard-reload ST so the updated `stmb-side-prompts.json` is re-fetched (before any
   side-prompt UI edit, or the in-memory copy clobbers the disk edit).
3. Regenerate each character's Epistemic tracker once (re-emits with `(#N)`).
4. Drive a scene until a fact ages out; confirm a gated, vectorized entry appears in
   `🏠 TWW2 - Deep Facts` (characterFilter = knower only), and a Shilpa fact never
   activates for Aisha.
