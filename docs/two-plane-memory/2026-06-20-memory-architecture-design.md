# Memory Architecture — STMB as single engine, SM's best migrated in

**Status:** BRAINSTORM CAPTURE (2026-06-20). Decisions + open questions recorded so they
survive a context reset. **Not an approved spec, not cleared for implementation.** The
brainstorm is ongoing.

**Scope:** spans three of the user's own extensions — Smart-Memory (SM), STMB (Memory
Books), State Tracker (ST-ST) — in `/ssd/Workspace/Projects/SillyTavern-Extensions/`.

---

## 1. Decision & rationale

Make **STMB the single memory engine** and migrate SM's best ideas into it; turn SM's
memory role off. Driven by 5 STMB pains the user hit (cross-chat carry; blind 20-turn
timer; group entry/exit & presence ignored; no ST-ST integration; missing perspectives /
relationship-history / scene-detection). See memory `memory-engine-decision.md`.

**Trade-offs accepted:** SM wins on cross-chat carry, presence/witness, perspectives,
relationships, fine-grained extraction; STMB wins on hierarchical compression
(arc→chapter→book→legend→series→epic) and true vector/semantic recall — the two axes we
want. SM's 25-cap is a hard delete (not a retired pool), which is the disqualifier.

## 1.5 The group-POV failure mode (what blocked last time) + guardrails

**Last attempt's root cause:** the pipeline asked the LLM to GENERATE each character's POV
("summarize from X's view"). Two failures: (a) LEAK — the model sees the whole transcript so
unwitnessed content bleeds into X's memory (LLMs are unreliable at "only what X saw");
(b) DIVERGENCE — N POV calls = N inconsistent versions of the same events; rollups can't pick
a POV. POV was a *generation* problem given to an unreliable judge.

**Why this design can't repeat it:** POV is NEVER generated. Split the fused concerns —
WHAT HAPPENED = objective LLM summary; WHO WITNESSED = deterministic from StateTracker's
per-message `audience` stamp → `characterFilter`. POV = read-time FILTER on one shared truth.

**Universal rule:** group messages by `audience` stamp → one objective summary per group →
one entry, `characterFilter = group audience`. A whisper is just its own group (+ a templated
shell @ present-cast). Each char reads entries whose audience ⊇ them = exactly what they
witnessed; all slices come from the SAME facts (no divergence).

**The guarantee (not a hope):** feed the summarizer ONLY the group's messages — it cannot
leak what it never sees. Deterministic INPUT-FILTERING replaces prompt-pleading. Rollups:
same-audience leaves only.

**New risk moved off the LLM onto 3 deterministic deps (all testable, kill early):**
1. Stamp quality — unstamped = fail-open = leak; missed whisper = leak. Plane 1 INHERITS
   StateTracker correctness → verify stamps on group scenes before building on them.
2. Input filtering — chatcompile MUST pass group-messages-only to the summarizer. Enforce+test.
3. Name canonicalization — stamp-lowercase vs card-name mismatch → characterFilter fails
   OPEN. One shared canonical map + test.

**De-risk gate:** the group-POV acceptance test (Sachin/Shilpa/Aisha + Kanti-Sweets, expected
per-char memories) is written FIRST = Phase 0's gate + permanent regression. If Aisha's
memory ever contains "Kanti Sweets" → RED. Cannot ship the blocker undetected.

**Scope honesty:** Phase 1 solves WITNESS POV (what each char saw — the blocker). INTERPRETIVE
POV (Aisha reads it as flirting) = subjective belief = Plane 2 (deferred).

## 2. Engine roles after migration

| Engine | Role |
|---|---|
| **STMB** | THE memory: Plane 1 (narrative spine) + Plane 2 (context tracker) |
| **State Tracker** | scene/state routing + per-message `audience` stamp + presence + `reality` tag |
| **Smart-Memory** | memory role OFF (ideas ported into STMB) |

## 3. Two-plane model (resolves the witness-vs-hierarchy tension)

- **Plane 1 — Narrative spine** = memory books. Objective "what happened", hierarchical
  (scene→…→epic), vectorized. Leaf scenes carry `witnessedBy`; rollups = shared narrative.
- **Plane 2 — Character knowledge** = the context-tracker side prompt. Per-character,
  flat, witness-scoped, injected privately: atomic facts + perspectives/secrets (knows /
  suspects / unaware / believes / hiding) + pairwise relationship state. **Never rolled up.**

Witness-scoping lives ONLY in Plane 2 + Plane-1 leaves; private content never enters a
rollup, so the pyramid can't leak. Rule: **leaf-sharp / rollup-soft** witness (recent =
exact presence; distant rollups may blur attribution — also psychologically realistic).

**Rollup char-filtration (resolved): audience-homogeneous FRAGMENTS.** `characterFilter` is
ONE audience-set per entry, so a rollup that spans segments with different audiences can't be
one entry. Apply "segment by audience" recursively: when rolling up, GROUP child segments by
audience set and summarize per group; each fragment gets `characterFilter = its audience`. A
character's arc = union of fragments whose filter includes them = exactly what they saw (the
fragments cover disjoint segments → no duplication). Cost scales with DISTINCT audience
compositions, not cast size (all-present-whole-arc = 1 fragment). {{user}} anchors most
audiences, so fragments collapse toward one in protagonist-centric play. Gradient: keep
fragments sharp at warm tiers (scene/arc/chapter); at cold high tiers (book→epic) optionally
collapse to a single union fragment and accept soft leak of broad public strokes. ST caveats:
`characterFilter` is single-per-entry (hence multiple fragments, not a complex filter); and
audience stamps (lowercased) must canonicalize to card names or the filter fails OPEN.

## 4. Keystone — Scheme B *is* the witness model

A Scheme-B-aware extractor derives `witnessedBy` per character for free:
- plain narration / `"dialogue"` → everyone present
- `*italic thought*` → that character only
- `> texting / [DM → X]` → sender + recipient (channel + target encoded in the markup)
- `((narrator aside))` → no character

So "integrate witnessedBy" and "Scheme B prompts" are ONE mechanism: the Scheme-B parse
computes perception.

## 5. Scaling — summarize once, filter at read (NOT per-character generation)

Current STMB writes per-character POV memories → N chars = N LLM calls + buggy rollups.
Replace with:

1. **Segment the timeline by AUDIENCE** (consume ST-ST `[SCENE audience=…]`; new segment on
   any audience-composition change). Each segment is audience-stable → one clean `witnessedBy`.
2. **One objective (omniscient) summary per segment**, tagged with that segment's audience.
   A character's memory of a scene = union of segments they were in (a filter, no LLM).

Result: **cost scales with audience-changes, not cast size.** 10 chars all present = 1 call.
Rollups operate on the objective spine → the per-POV rollup bug disappears.

## 6. Graded perception — shell + content (two tiers, decided)

A pure filter can't represent "Shilpa hears the whisper; Aisha sees only that a whisper
happened." So a privacy-narrowed event becomes **two linked atoms**:

```
event: Sachin whispers "Kanti Sweets" to Shilpa
  ├─ SHELL    "Sachin whispered something to Shilpa"  audience = present cast  [Sachin,Shilpa,Aisha]
  └─ CONTENT  "the shop is Kanti Sweets"              audience = targets       [Sachin,Shilpa]
```

- `shell.audience = present_cast`; `content.audience = narrowed stamp`; shell-observers =
  `present_cast − content_audience` — derived, no LLM; shell is a deterministic template.
- **DECIDED: exactly two tiers.** "Caught a fragment" (partial overhearing) collapses to the
  shell — no third tier.
- This also fixes a LIVE bug: today `displayHider` hides the whole whisper from Aisha; the
  shell should stay visible so she can react to the social act.

**Whisper = directed private channel (unification, decided).** Whisper and DM/remote are the
same primitive — `audience = author + targets`. Only difference is co-presence: alone → no
shell; in-room → shell. `whisperDetect` should set the SAME narrowed stamp a `to:`/`@`/DM
directive sets; the shell is one derived overlay. Surface prose stays per-medium (spoken
quote vs `>` blockquote); the channel/redaction model is shared.

## 7. Trigger & ownership

**Trigger:** fires when `content_audience ⊊ present_cast` AND the act is observable. Covers
whisper, in-room texting, in-room call. NOT inner thought / pure-remote-no-observer /
narrator aside / normal speech. Shell specificity is channel-typed (whisper names the
target; phone text usually doesn't).

**Ownership — the main LLM gets NO new markers:**
- Detect private + audience: texting/DM/remote = deterministic from Scheme B markup or
  `to:`/`@` directive; spoken whisper = existing `whisperDetect` side-LLM seat (#99 unified,
  shared with presence auditor + summon). No new main-LLM marker, no new side-LLM seat.
- Content = the message itself. Shell = deterministic template from the stamp. ~zero new LLM.

## 8. STMB integration — what exists vs what's missing

**Already exists (proven):**
- ST-ST stamps every message: `msg.extra.channel = {id, audience[], remote?, reality?}`;
  `whisperDetect` narrows audience; `remoteRedaction` span-filters; `reality` tag for unreal.
- STMB `witnessScope.js`: `audienceOf`, `messageWitnessedBy`, `isPresentInWindow` — reads
  the ST-ST stamp, fail-open, "agrees with SM's witness.js." **Wired ONLY to `sidePrompts.js`
  (Plane 2).**

**Missing (the actual work):**
1. **Plane 1 is witness-blind** — `stmemory/chatcompile/addlore/autocreate/sceneManager` do
   not import `witnessScope`. → apply the same primitives to memory creation.
2. **Segment scenes by audience** — split a scene range on audience change
   (`audienceOf` per msg / `isPresentInWindow`).
3. **Entry audience tag** — memory entries carry no audience field today. Add one; populate
   from the segment's witness set. Candidate injection mechanism: ST-native
   `entry.characterFilter.names = audience` so an entry only activates when the responding
   char is in the audience (witness-filter for free; unfiltered = everyone = fail-open).
4. **Shell+content split** — a narrowed event emits TWO entries (shell `characterFilter` =
   present cast; content `characterFilter` = targets).
5. **Honor `reality`** — skip dream/flashback messages in `chatcompile` (ST-ST already writes
   the tag; STMB just reads it). Easy win.
6. **Vectorize + top-k**, then witness-filter the retrieved set at injection.

## 8.5 Storage & binding (where memories live)

- **Plane 1 = ONE shared per-WORLD book** `<World> - Memories` (the existing empty
  `<World> - Memories` pattern). NOT per-character. Every entry carries: `tier` (0 memory →
  6 epic; STMB `summaryTiers`), `characterFilter = audience` (the homogeneous fragment),
  vectorized. ALL rollup tiers (arc/chapter/book/…) live in this one book via the tier field
  — no separate arc book. Reasons over per-character: summarize-once (no duplication of
  shared scenes), characterFilter already does per-char gating, single vector collection,
  global dedup/consolidation.
- **Plane 2 = per-character**, but SPLIT by vectorized-vs-constant and SEPARATED from static
  card canon (engine must not write into hand-authored `<World> - <Name>`):
  - **Constant snapshot/trackers** (relationship state, mood, threads, hot secrets) → ONE
    shared `<World> - Trackers` book (or reuse `<World> - Actors`) with `characterFilter` per
    char. Constant entries aren't vector-ranked → NO dilution; characterFilter just gates.
  - **Vectorized DEEP store** (facts + epistemic) → PER-CHARACTER `<World> - <Name> · Mem`
    book. WHY per-char not shared: `queryMultipleCollections` uses a SINGLE character-blind
    topK; characterFilter prunes AFTER → a shared all-char collection dilutes the responder's
    top-k with other chars' similar facts (bites even in SOLO). Per-char book = own collection
    (`world_<hash(name)>`) → in 1:1 only that char's collection is queried → zero dilution.
    (Group: set char-lore to active-char or raise max_entries; characterFilter keeps it
    CORRECT regardless — dilution is recall-depth only.)
  - STATIC `<World> - <Name>` (voice/disposition/backstory @depth) stays hand-authored,
    engine-untouched.
- **"Switching" = binding, not swapping.** Plane 1 bound to the WORLD → auto-loads for any
  solo/group chat in it; characterFilter gates per responder. Plane 2 bound to the CARD →
  loads with the character. Mirrors the existing `<World> - Core`/`Actors` (shared) +
  `<World> - <Name>` (per-char) layout. Cross-chat carry works because books are
  world/character-bound, never chat-bound; world-bound Plane 1 keeps a character's memory of
  shared events consistent across all chats in the world.
- **Portability** (port a character w/ memories to another world) is still possible from the
  shared book: a character's memories = entries whose `characterFilter` includes them →
  export that slice on demand, no everyday duplication.

**Scale ("where to store that many entries"):** NOT one mega-book. Plane 2 is already split
per character (each char's book bounded to ~hundreds of their own facts). Plane 1 is the one
shared `<World> - Memories` that grows. At engine level "many" is fine: vector cosine over
10k+ is ms; vectorized entries are NOT keyword-scanned per turn (pulled by vector query);
each book = its own collection (world_<hash(name)>). Bound the ACTIVE set via hierarchy +
disable-prune: once leaves roll into an arc, DISABLE the aged leaves → removed from vectors
next turn (retained in JSON for provenance) → searchable set ≈ recent leaves + rollups,
~constant regardless of campaign length. Only growing cost: activateWorldInfo iterates all
loaded entries/turn (cheap: disable-check + content-hash) — at tens-of-thousands, ARCHIVE
disabled/cold entries to a separate UNLINKED book (not loaded), re-attach only for deep
history. Far-future optimization.

## 9. Plane 2 (context tracker) level-up

The existing STMB context-tracker (v2 per-char template) IS the Plane 2 prototype: 6 sections
(Model of {{user}}, Status scores, Active Threads, World&Cast, Private/secrets, Scene
Presence), overwrite-snapshot, capped/prune. GAP: it witness-scopes BY PROMPT ("exclude events
while {{char}} absent") = LLM-judged = the same blocker as old Plane 1.

**Witness fix (decided):** derive Plane 2 from X's WITNESSED slice via deterministic
input-filtering, NOT prompt self-censor. SOURCE = the raw messages where X ∈ audience
(witnessScope), with SHELLS substituted for narrowed content X didn't hear — raw for nuance
(mood/tone/relationship deltas live in the prose; summaries too lossy). Leaves = provenance
anchor + distant-history fallback. Per-char POV then correct by construction; provenance free;
guarantee chains from Plane 1's acceptance suite. (Recent → raw filtered msgs; distant → leaves.)

**Storage = two shapes:**
- STATE snapshot — ONE overwrite entry per char, always-on, capped (the current context
  tracker): relationship scores, mood/stress, stage, active threads, recent observations, hot
  secrets/suspicions.
- DEEP store — MANY vectorized entries per char, `characterFilter = owner`, each with a
  `source_leaf` field: durable facts + historical epistemic. ST retrieves top-k by relevance →
  only those inject. Dedup/supersede programmatically (embedding cosine, like SM). Handles the
  100–200-facts growth (store grows; injection bounded).
- Plane 2 injection/turn = [snapshot] + [top-k deep]. Rule: STATE→snapshot (caps/overwrite);
  durable FACTS + historical epistemic→deep (retain-all/top-k).

**Epistemic schema (confirmed):** per item `{tag: knows|suspects|unaware|believes|hiding,
holder=X, subject, target?, content, confidence, source_leaf}`. `believes` = possibly-false
belief (lies/misreads → memory); `unaware` = dramatic irony (model knows X doesn't know).
Active suspicions/secrets ride the snapshot; long tail is deep/top-k.

**Deep-store entry shape (decided):** one short fact/epistemic item per WI entry — separation
is FREE from the per-entry boundary (ST vectorizes per entry; a short fact = one clean
vector). `content` = the fact (the only thing embedded — vectorized WI is BODY-ONLY, `key[]`
dead). Provenance (`source_leaf` + chat/date) rides METADATA fields (like existing
`bootstrap_char`/`bootstrap_source`) — not embedded; used for witness-anchor + supersession +
injection-viewer debug, NOT for separation/retrieval.
CharMemory cherry-pick verdict: topic-tags NOT adopted (they disambiguate CharMemory's
multi-bullet shared chunks; in our one-fact-per-entry + body-only model they'd dilute short
embeddings; if ever wanted, put a topic label in `comment` (display-only, unembedded), not
`content`). Provenance idea kept (already in design as source_leaf), justified independently.

**Lorebook vs Data Bank file for the deep store — PERFORMANCE decides it (lorebook wins):**
Considered a delimiter-split per-char Data Bank file (only_custom_boundary + force_chunk_
delimiter) to avoid entry sprawl. Code (vectors/index.js) shows it's WORSE for a growing store:
files are URL-keyed (`getFileCollectionId = file_<hash(url)>`) and skipped if the collection
has any hashes → (a) edits DON'T auto-refresh (stale until manual purgeFileVectorIndex +
re-ingest), (b) refresh = WHOLE-FILE re-embed (cost grows with the file), (c) both vectorize
& retrieve run inside rearrangeChat (the generation interceptor) so an in-band whole-file
re-embed lags that turn. WI entries vectorize INCREMENTALLY per-entry (add one fact → embed
one; auto-synced by hash) — no whole-file cost, auto-indexed, clean per-entry provenance.
DECISION: deep store = vectorized LOREBOOK entries (per-char Plane 2 book). Sprawl is cosmetic
UI-only (entries are programmatic + characterFilter'd), not a runtime cost. If files are ever
forced: split hot/cold by volatility (not schema), trigger out-of-band purge+re-ingest.
**Vectorize OUT-OF-BAND** (right after extraction writes, between turns) regardless of
substrate, so generation only ever runs the fast retrieval query. Steady-state turns (no new
memories) cost nothing but the query.

**Entry lifecycle (disable = vector-prune; confirmed in activateWorldInfo):** disabling a WI
entry excludes it from the per-world index set → next-turn synchronize deletes its hash from
the vector collection (`deleteVectorItems`). So:
- active   = enabled  → vectorized + retrievable
- retired  = disable  → auto-removed from vectors next turn, NOT retrievable, NOT polluting,
             but RETAINED (restorable/auditable) = SM's "retired pool" + vector-pruned for free
- obsolete = delete   → gone everywhere
→ Use DISABLE for supersession/staleness (source leaf contradicted) instead of hard delete.
WI vectors are keyed by hash(content) → also edit-aware (edit → old hash deleted, new inserted,
one entry). Caveat: disable removes from VECTORS, not the entry COUNT (entry stays inert in
the book); delete to actually shrink the store/UI.

**snapshot↔deep line (RESOLVED 2026-06-20):** the line === Trackers-book ↔ Mem-book.
SNAPSHOT (always-on, constant, OVERWRITE → `<World> - Trackers`, characterFilter): relationship
scores (Affinity/love/lust/Relationship/Trust), mood/stress/stage, active threads (≤6), recent
observations (≤8), stable traits (≤12), hot/active secrets+suspicions, scene presence.
DEEP (retrieved top-k, vectorized, APPEND → `<World> - <Name> · Mem`): durable facts (long tail),
historical epistemic (cooled knows/believes/secrets), long-tail NPC/world impressions.
RULE: needed-every-turn → snapshot; needed-only-when-relevant → deep. Facts/epistemic SPLIT by
HOTNESS not wholesale — fresh observation/active suspicion rides the snapshot; once it cools it
ages into a deep Mem entry (snapshot overwrite drops cooled items; promotion writes a Mem entry).

## 10. Cross-chat carry

Memory lorebook must be **character/world-bound** so it travels. Pre-switch flush of the last
~20 messages, but it MUST fire on the OUTGOING chat (SM's bug: `CHAT_CHANGED` runs in the
chat you land on) — hook the pre-switch event or stamp the outgoing chat id.

## 11. Open questions / next steps

- Plane 2 schema: exact fields the context tracker carries per character, and how its facts
  link back to the Plane-1 leaf they were derived from.
- Build order / incremental-vs-rewrite for the STMB changes.
- Whether shell generation lives in STMB (memory-only) or ST-ST stamp-time (fixes live
  `displayHider` too) — leaning ST-ST.

## 13. Plane 1 — phased build (proposed 2026-06-20)

CONFIRMED 2026-06-20: Plane 1 = shared `<World> - Memories` (world-bound; portability
minimal/none); sharp→soft cutoff = sharp through arc/chapter, union+soft from book up;
Plane 2 schema DEFERRED (separate pass).

- **Phase 0 — Plumbing (no behavior change):** create world-bound `<World> - Memories`
  (vectorized); entry writer gains `tier` + `audience`, map audience→`characterFilter`;
  shared name-canonicalization with witnessScope; honor `reality` tag (skip dream/flashback);
  import witnessScope into the memory pipeline (today only sidePrompts). Done: entries write
  tier+characterFilter, unreal skipped, else unchanged.
- **Phase 1 — Audience-segmented leaf memories (core):** segment scenes by audience; one
  objective summary per segment → leaf entry (tier 0); characterFilter-gated injection
  (fail-open). Done: solo correct; group char recalls only segments witnessed.
- **Phase 2 — Graded perception (shell+content):** narrowed event → 2 entries (shell @
  present-cast, content @ targets); unify whisper as directed channel at ST-ST. Done: Kanti
  Sweets case (Aisha=shell, Shilpa=both); live displayHider shows shell.
- **Phase 3 — Rollups as audience-homogeneous fragments:** arc(tier1)+ group leaves by
  audience → fragments (characterFilter=group audience); sharp thru arc/chapter, union+soft
  from book. Done: mixed-audience arc → correct fragments.
- **Phase 4 — Retrieval & cross-chat:** vector top-k + witness filter + tier-aware bias;
  pre-switch last-20 flush on OUTGOING chat; world-bound loading verified. Done: by-meaning,
  witness-correct recall; tail captured; carries across chats.
- **Phase 5 — Cut over:** turn OFF SM long-term (Plane 1 owns episodic); SM
  epistemic/relationship stay until Plane 2. Done: SM long-term off, no regression.

Phases 0–1 are independently usable (witness-correct flat memory, no hierarchy).

## 12. References

- Memory: `memory-engine-decision.md`, `smart-memory-architecture-ref.md`,
  `sillytavern-wi-retrieval-mechanics.md`, `project-scheme-b-formatting.md`.
- Acceptance tests: `2026-06-20-memory-pov-acceptance-tests.md` (the witness-POV gate suite —
  38 scenarios: use / edge / negative-leak-guards / cross-chat / retrieval).
- PROJECT-LOG: cont. 57h–57p (2026-06-20).
- Code: STMB `witnessScope.js`, `sidePrompts.js`, `stmemory.js`, `chatcompile.js`,
  `addlore.js`, `summaryTiers.js`, `sceneManager.js`; ST-ST `channelVisibility.js`,
  `whisperDetectLogic.js`, `remoteRedaction.js`, `audienceCommand.js`, `presenceContext.js`.
