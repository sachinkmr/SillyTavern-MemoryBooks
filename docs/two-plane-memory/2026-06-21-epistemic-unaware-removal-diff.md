# Diff-doc — Remove `## Unaware` from the Epistemic tracker (D6 leak fix)

**Status:** APPLIED 2026-06-21 (verified by structural diff: only epistemic-tracker
prompt + responseFormat changed; no "Unaware" remains). Backup:
`stmb-side-prompts.json.bak-20260621-unaware`. Pending: user hard-reload + one regen.
**Date:** 2026-06-21
**Target:** `epistemic-tracker` template in the LIVE store
`data/default-user/user/files/stmb-side-prompts.json` (prompt + responseFormat).
**Why:** Unaware is NEGATIVE knowledge — recording "she does NOT know X" requires
naming X, and the section sat in each character's OWN `[char]`-gated entry, so it
injected the named secret into the unaware character's generation context = a standing
leak vector. Unawareness is already encoded by ABSENCE (witness gating + content-free
shells). See spec §4 / D6 in `2026-06-21-epistemic-deep-save-spec.md`.

## Edits (3, epistemic-tracker only)

**E1 — prompt, section count:**
- BEFORE: `2. ONLY the five sections in the Response Format, in order.`
- AFTER:  `2. ONLY the four sections in the Response Format, in order.`

**E2 — prompt, TAGS list (remove the UNAWARE bullet entirely):**
- REMOVE: `- UNAWARE — something story-relevant {{char}} does NOT know (dramatic irony). {{char}} cannot act on it. List only items that matter.`
- (BELIEVES bullet now flows straight into HIDING.)

**E3 — responseFormat (remove the output section):**
- REMOVE:
  ```
  ## Unaware
  - [topic] — [what {{char}} does not know]
  ```
- Remaining sections: Knows, Suspects, Believes (may be false), Hiding.

## Not changed
- PERSPECTIVE line ("NEVER record anything {{char}} has no way of knowing") stays —
  removing Unaware makes the prompt MORE consistent with it (Unaware was the lone
  section that recorded what she does not know).
- No relocation / author-only note: per the directive, Unaware is dropped outright.

## Apply / verify
1. Backup `stmb-side-prompts.json`.
2. Python targeted replace with count==1 asserts on each edit.
3. Structural diff: ONLY `/prompts/epistemic-tracker/{prompt,responseFormat}` change.
4. User hard-reloads ST before any side-prompt UI edit (in-memory copy clobbers disk).
5. Regenerate one Epistemic tracker; confirm no `## Unaware` section emitted.
