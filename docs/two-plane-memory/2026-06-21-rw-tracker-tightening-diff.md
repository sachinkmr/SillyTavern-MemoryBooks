# Diff-doc — R/W tracker prompt tightening (bounded consolidation)

**Status:** APPLIED 2026-06-21 to `world-tracker` only (prompt + responseFormat),
verified by structural diff (only those 2 fields changed). relationship-tracker
unchanged (already fixed-size). Backup: `stmb-side-prompts.json.bak-20260621-rwtweak`.
Pending: user hard-reload + one regen to confirm `(#N)` tags emit and age-out drops.
**Date:** 2026-06-21
**Scope:** the two R/W side-prompt templates in
`data/default-user/user/files/stmb-side-prompts.json`: `relationship-tracker`,
`world-tracker`. (Epistemic is out of scope — handled by the deep-save spec.)

## Finding (why this is small)

Read the live prompts. The R/W trackers are ALREADY mostly bounded:

- **relationship-tracker** — a FIXED-SIZE score panel (Affinity / lovefactor /
  lustfactor / Relationship / Trust+peak+ceiling / Mood / Stress / Stage + a
  2-sentence OOC). It cannot grow unbounded; every run emits the same fixed set.
  Self-bounding. **Recommend NO CHANGE.**
- **world-tracker** — ALREADY has a PRUNE CHECK (>=20 bullets), per-section caps
  (Stable <=12, Recent <=8, Threads <=6, Cast <=8), and promote/drop rules.

## The one real gap (world-tracker)

The staleness rules ("Observation unchanged 3+ updates -> drop", "Thread
unmentioned 3+ updates -> drop", "confirmed across 3+ scenes -> promote") require
counting per-item update-age, but the model has no age signal — it sees the
current living entry + ~2 scene memories, no per-item history. So "3+ updates" is
guesswork: stale items linger, fresh items get dropped arbitrarily.

### Fix — computable age tags

Give each Recent Observation and Thread a tag `(#N)` = the update it was first
noted / last re-confirmed. Then `age = current# − N` is computable from the
single living entry, making the EXISTING prune/promote rules reliable.

**world-tracker prompt — BEFORE (PRUNE CHECK clause):**
> 1. PRUNE CHECK: count total bullets. If >=20 -> prune: merge duplicates, drop
> stale, promote confirmed. Recent Observation confirmed across 3+ scenes ->
> promote to Stable Trait. Observation unchanged 3+ updates -> drop. Thread
> unmentioned 3+ updates -> drop.

**world-tracker prompt — AFTER:**
> 1. PRUNE CHECK: count total bullets. If >=20 -> prune: merge duplicates, drop
> stale, promote confirmed. Each Recent Observation and Thread carries `(#N)` =
> the update it was first noted or last re-confirmed; compute age = current# − N.
> Re-confirmed this update -> re-stamp N to current#. Observation with age >= 3
> and unconfirmed -> drop. Observation re-confirmed across 3+ updates -> promote
> to Stable Trait (drop its tag on promotion). Thread with age >= 3 and
> unmentioned -> drop.

**world-tracker responseFormat — BEFORE:**
> ### Recent Observations *(<=8 — last 2-3 scenes; promote or drop after 3 updates)*
> - [what {{char}} just noticed/learned]
> ...
> **[Thread Title — {{char}}'s stake]** — `developing` | `ready to resolve` | `stale`

**world-tracker responseFormat — AFTER:**
> ### Recent Observations *(<=8 — last 2-3 scenes; promote or drop after 3 updates)*
> - [what {{char}} just noticed/learned] `(#N)`
> ...
> **[Thread Title — {{char}}'s stake]** `(#N)` — `developing` | `ready to resolve` | `stale`

Cost: ~4 chars/bullet (~80 chars at the <=20 budget) — negligible.

## Out of scope / NOT changed
- relationship-tracker: no change (already fixed-size).
- The carry-forward DRIFT risk (small model silently dropping "carry verbatim"
  items) is NOT fixable in-prompt — addressed by the Epistemic deep-save, and the
  same durable-store pattern can later back R/W if drift proves real.

## Apply (on approval)
1. Backup `stmb-side-prompts.json` (+ settings if the templates are mirrored there).
2. Edit ONLY the `world-tracker` `prompt` + `responseFormat` strings as above.
3. User hard-reloads ST; regenerate one World tracker; confirm `(#N)` tags appear
   and an aged-out observation drops on the following update.
