# Spec — Epistemic deep-save (Plane-2c): hot/cold knowledge store

**Status:** SPEC FOR REVIEW — design only. No build authorized; awaiting user sign-off.
**Date:** 2026-06-21
**Decision (pivotal, chosen by user):** HYBRID — cold store is an ST-native
*vectorized, characterFilter-gated lorebook* (retrieval is native, free, witness-safe);
STMB owns the WRITE / age-out / curation path (`plane2.js`).
**Relates to:** [[memory-engine-decision]]; Epistemic tracker (`epistemic-tracker`
template) already says *"Resolved or distant knowledge ages out (a later phase moves
it to deep storage)"* — this spec is that phase.

---

## 1. Problem

The Epistemic tracker is a per-character REPLACE-based read-modify-write snapshot
(confirmed: `prior = existing.content` → regenerate full entry → overwrite). Two
failure modes follow:

1. **Bloat** if it accumulates every fact a character ever learned → unbounded hot
   entry, injected every turn.
2. **Drift** if it stays bounded by forgetting: the model RE-TYPES every carried
   item each run, so a small model (gemma4 / deepseek-flash) silently drops/reworps
   facts. Over many runs, knowledge a character *should* hold decays.

Lossy forgetting of *knowledge* is a continuity break (a character "forgets" a
secret she was told). So Epistemic needs **bounded hot context + lossless durable
recall** — a two-tier store.

(Relationship/World do NOT need this: Relationship is a fixed score panel; World is
current-state with prune caps. Only Epistemic accumulates lossless-required facts.)

## 2. Architecture (two tiers, Hybrid)

```
            Epistemic side-prompt (per char, witness-filtered scene + prior hot)
                                   |
                 emits: updated HOT entry  +  "## To Deep Storage" eviction list
                                   |
    +-------------------------------+--------------------------------+
   | HOT (Plane-2)                  | WRITE/AGE-OUT (plane2.js, STMB)|
   | 🏠 TWW2 - Trackers             | consume eviction list ->       |
   | Epistemic <Char> entry         | dedup + shape + write COLD     |
   | active beliefs, (#N) age tags  |                                |
   +-------------------------------+--------------------------------+
                                                  |
                                   COLD (Plane-2c, ST-native)
                                   🏠 TWW2 - Deep Facts (new book)
                                   per-(char[,topic]) vectorized,
                                   characterFilter-gated entries
                                                  |
                              ST WI vector retrieval (FREE, native)
                                                  |
                              injects relevant cold facts -> MAIN LLM
```

- **HOT** = the existing per-character Epistemic entry in `🏠 TWW2 - Trackers`.
  Stays small (active/in-play beliefs only). Gains `(#N)` age tags (same mechanism
  just shipped for world-tracker) so age-out is computable.
- **COLD** = a NEW book `🏠 TWW2 - Deep Facts` (one per world, consistent with
  Memories/Trackers). Per-character `characterFilter`-gated, **vectorized** entries.
  Native ST retrieval surfaces them into the Main LLM on-demand.
- **WRITE path** (`plane2.js`, STMB-owned) is the only custom code: it consumes the
  side-prompt's explicit eviction list and writes curated cold entries.

## 3. The key insight — EXPLICIT eviction, not diff

Because hot is REPLACE-based, STMB cannot tell an *intentional age-out* from
*accidental drift* by diffing prior-vs-new. So eviction is made **explicit**: the
Epistemic side-prompt gains an output section

```
## To Deep Storage
- [tag] [about whom] — [fact] — reason: resolved | distant
```

listing exactly the items it is moving out of hot this run. STMB's write path
consumes ONLY that section. Consequences:
- Hot→cold transfer is curated and lossless (the model *declares* what it moves).
- The model must account for every cold-eligible item it drops (keep in hot, or list
  it here) — which also suppresses silent drift on cold-eligible facts.

## 4. What is cold-eligible (5-tag model)

- **Knows / Believes (may be false) / Suspects** → cold-eligible. Believes is stored
  AS BELIEVED — never "corrected" by retrieval; witness gating keeps it to that char.
- **Hiding** → stays HOT while the secret is active; on resolution it drops (the
  underlying fact persists as others' Knows). Not cold-stored as a "hiding" relation.
- **Unaware** → NEVER stored — and storing it would CREATE a leak, not prevent one.
  Unaware is *negative* knowledge ("she does NOT know X"); to record it you must name
  X. A per-character store gated to her + injected into her own generation context
  would therefore feed the secret X straight into the Main LLM while it plays her =
  the exact leak. Unawareness is already encoded by ABSENCE: witness gating + shells
  guarantee she simply lacks the fact (she got the content-free shell, not content).
  Her not-having-it IS her unawareness. (Done 2026-06-21: the hot Epistemic template's
  `## Unaware` section — a standing leak vector that injected the named secret into the
  unaware char's own context — was removed outright. See D6 / the removal diff-doc.)

## 5. Cold entry shape (serves BOTH retrieval paths)

ST vectorizes the BODY only, while keys keyword-scan (see
[[sillytavern-wi-retrieval-mechanics]]). So each cold entry:

- **content (body, embedded):** the fact in natural language, char-subjective POV,
  e.g. *"Shilpa knows Sachin lost his IndraNagar flat and is hiding the debt."*
- **keys (keyword-scan):** salient names/nouns — `Sachin, flat, debt, IndraNagar`.
- **characterFilter:** `[shilpa]` (the knower) — witness gate; retrieval can only
  surface it for that character. Inherited from the hot entry's gate.
- **metadata:** `tag` (knows/believes/suspects), `about` (whom), `since#` (hot update
  it was minted), `evictedAt#`, `source` (witnessed/told/inferred). For Believes,
  a `false: true` marker so it is never reconciled against truth.

Granularity: **one entry per (character, fact)** for clean dedup + targeted
retrieval. (Alt: per (character, topic) cluster — fewer entries, coarser recall.
Default = per-fact; revisit if entry count explodes.)

## 6. Retrieval (native, witness-safe)

- Cold entries vectorized + `characterFilter`-gated → ST WI surfaces top-k relevant
  facts into the Main LLM context when the scene's content/keys match. **No extra
  call.** characterFilter ensures a cold fact only ever activates for the character
  who knows it → no leak.
- Over-pull dials: `max_entries` / score `threshold` / `match_whole_words` (per
  [[sillytavern-wi-retrieval-mechanics]]) bound how many cold facts inject — tune so
  recall stays sharp and the hot context doesn't bloat.

## 7. Re-promotion (cold → hot)

**v1 (organic):** a relevant cold fact gets injected to the Main LLM → the RP
references it → next Epistemic run sees the reference in the (witness-filtered) scene
→ re-adds it to hot, re-stamped `(#N)`. No extra machinery.
**v2 (proactive, later):** also feed cold top-k to the Epistemic *curator* side-prompt
as context so it can re-promote before the Main LLM surfaces it. Adds a retrieval
read for the side-prompt; defer unless v1 recall proves too lazy.

Dedup: writing a cold fact that already exists updates in place (key = char + about +
normalized fact). Re-promotion leaves the cold copy (idempotent); it simply also
appears hot until it ages out again.

## 8. Build phases (TDD, subagent-decomposable)

1. **Hot age-tags for Epistemic** — add `(#N)` + "## To Deep Storage" section to the
   `epistemic-tracker` template (doc-first prompt diff). No code.
2. **Cold book + entry shape** — `plane2.js` helpers (pure): build cold entry from an
   eviction item (body, keys, characterFilter, metadata); dedup key.
3. **Write/age-out wiring** — after the Epistemic side-prompt run, parse "To Deep
   Storage", write/dedup into `🏠 TWW2 - Deep Facts`, gated per character. Hook into the
   existing per-character side-prompt completion path.
4. **Cold book config** — vectorized, characterFilter on; retrieval dials set.
5. **Witness + no-leak tests** — a cold fact for Shilpa never activates for Aisha;
   Believes-false never reconciled; Hiding not cold-stored; Unaware excluded.
6. **(v2, optional)** proactive re-promotion feed.

## 9. Decisions (resolved 2026-06-21)

- D1: Cold book name — **DECIDED: `🏠 TWW2 - Deep Facts`** (single per-world book,
  per-character gated). "Trackers"/"Stats" rejected (mislead: trackers=hot panels,
  stats=numeric). "facts" is loose for Believes/Suspects but each entry is
  truth-tagged; `Deep Knowledge` is the precise alt if ever preferred.
- D2: Granularity — **per-fact** (accepted default).
- D3: Age-out threshold — `age >= 3` updates AND not in current scene, or hot over a
  per-section size budget (accepted default).
- D4: Re-promotion — **v1 organic** first; v2 proactive later (accepted default).
- D5: Hiding on resolution — **drop** (the fact persists as others' Knows) (accepted).
- D6 (from Unaware discussion): the hot Epistemic template's `## Unaware` section was
  a latent leak vector (injected the named secret into the unaware char's own context).
  **RESOLVED 2026-06-21: removed outright** from the `epistemic-tracker` prompt + format
  (now Knows/Suspects/Believes/Hiding). See `2026-06-21-epistemic-unaware-removal-diff.md`.

## 10. Risks / edge cases
- **Drift on cold-eligible items**: mitigated by the explicit eviction section (model
  must account for every dropped cold-eligible fact).
- **Vector over-pull** bloating hot context: bound via max_entries/threshold (D3).
- **Stale Believes**: never auto-correct; only the owning character's later
  experience (a new Knows that supersedes) updates it, via the normal hot run.
- **Cross-char leak**: structurally prevented by characterFilter on every cold entry
  (same gate that already makes the hot trackers witness-correct).
