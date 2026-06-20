# Memory POV — Acceptance Test Catalog (write FIRST, build against)

**Purpose:** prove witness-correct memory before/while building (the blocker that killed the
last attempt). Each scenario is a fixture: present cast + stamped messages → expected
per-character memory. `S`=Sachin/{{user}}, `Sh`=Shilpa, `A`=Aisha, `P`=Priya (AI chars
except S). `⊇` must contain, `⊉` must NOT contain. Audience always includes `S` (user forced).

Companion to `2026-06-20-memory-architecture-design.md`. Phase tags: which phase must make
each green.

---

## A. USE CASES (normal flows) — witness POV correct

**U1 — Solo chat [P1].** present: S,Sh. All room talk.
→ Sh ⊇ whole scene. (Trivial; single audience. Guards: solo path still produces a memory.)

**U2 — Full-group shared scene [P1].** present: S,Sh,A. All `@room`.
→ Sh and A both ⊇ same scene, identical underlying facts. (Guards: no divergence.)

**U3 — Character absent whole scene [P1].** present: S,Sh (A elsewhere). All `@room`.
→ Sh ⊇ scene; A ⊉ anything from it. (Guards: absence = no memory.)

**U4 — Character enters mid-scene [P1].** seg1 `@{S,Sh}`, then A enters, seg2 `@{S,Sh,A}`.
→ A ⊇ seg2 only, ⊉ seg1. Sh ⊇ seg1+seg2. (Guards: enter boundary split.)

**U5 — Character exits mid-scene [P1].** seg1 `@{S,Sh,A}`, A leaves, seg2 `@{S,Sh}`, A returns seg3 `@{S,Sh,A}`.
→ A ⊇ seg1+seg3, ⊉ seg2. Sh ⊇ all. (Guards: exit/return split — the core asymmetry case.)

**U6 — Whisper, canonical [P2].** present: S,Sh,A. `S whisper→Sh "shop is Kanti Sweets"`.
→ Sh ⊇ content; A ⊇ shell ("S whispered to Sh"); A ⊉ "Kanti Sweets". (THE blocker test.)

**U7 — DM/text to a present char [P2].** present: S,Sh,A. `S >[DM→Sh] "…"` (Scheme B blockquote).
→ same as U6 (directed channel): Sh ⊇ content; A ⊇ shell "S was texting"; A ⊉ content.

**U8 — Text to a REMOTE (absent) char, sender co-present [P2].** present: S,A. `S >[DM→Sh] "…"` (Sh remote).
→ Sh ⊇ content (as participant); A ⊇ shell "S was texting someone"; A ⊉ content & ⊉ that it was Sh.

**U9 — Arc rollup, uniform audience [P3].** segs all `@{S,Sh,A}` → arc.
→ one arc fragment @{S,Sh,A}; Sh and A both ⊇ it.

**U10 — Arc rollup, mixed audience [P3].** seg1@{S,Sh,A}, seg2@{S,Sh}, seg3@{S,Sh,A}.
→ frag-X=summary(seg1+seg3)@{S,Sh,A}; frag-Y=summary(seg2)@{S,Sh}. A ⊇ X only (⊉ seg2 content);
Sh ⊇ X+Y. (Guards: audience-homogeneous fragments; rollup no-leak.)

## B. EDGE CASES

**E1 — Inner thought in a group [P1/P2].** present: S,Sh,A. `A *thinks: I like him*` then `A "…"` aloud.
→ A ⊇ the spoken line (+ optionally the private thought as A's own); Sh,S ⊇ spoken line, ⊉ A's thought.
No shell for a thought (not observable). (Guards: thought is self-only, no spurious shell.)

**E2 — Narrator aside [P1].** `((Unknown to them, the shop closes tomorrow.))`
→ no character's memory contains it. (Omniscient context only.) (Guards: ((…)) never witnessed.)

**E3 — Unreal scene (dream/flashback) [P0].** scene messages carry `reality: dream`.
→ no memory created for anyone. (Guards: reality tag honored.)

**E4 — Whisper with NO bystander [P2].** present: S,Sh only. `S whisper→Sh "…"`.
→ Sh ⊇ content; NO shell entry emitted (present_cast == content_audience). (Guards: no spurious shell.)

**E5 — Two simultaneous private channels [P2].** present: S,Sh,A,P. `S whisper→Sh "x"`; `A >[DM→P] "y"`.
→ Sh ⊇ "x"; P ⊇ "y"; A ⊇ shell(S→Sh whisper) + own "y"; Sh ⊇ shell(A texting); etc. Cross-leak: none.

**E6 — Present but ASLEEP/muted [P1].** present roster: S,Sh,A; A asleep → stamp audience excludes A.
→ A ⊉ anything said while asleep, even though "present." (Guards: presence ≠ witness; stamp authoritative.)

**E7 — Partial overhearing collapses to shell [P2].** `S whisper→Sh "…sweets…"`, A catches a fragment.
→ A ⊇ shell only (decided: 2 tiers, no fragment tier); A ⊉ content. (Guards: 2-tier decision.)

**E8 — Rollup at COLD tier goes soft [P3].** book-tier rollup over mixed audiences.
→ single union fragment @ union-audience; soft-leak of broad public strokes ACCEPTED (by design);
private content still absent (never rolled up). (Guards: sharp→soft cutoff at book.)

**E9 — Audience grows then shrinks across a long scene [P1].** many entry/exit changes.
→ each char's memory = exact union of segments they were stamped into. (Guards: N-way segmentation.)

**E10 — Same fact stated publicly later [P1/P3].** A misses seg with fact (private), but it's later said `@room`.
→ A ⊇ the public statement (legitimately learned), even though ⊉ the earlier private one. (Guards: learning ≠ leak.)

## C. NEGATIVE CASES (must-NOT — leak & integrity guards)

**N1 — No content leak [P2].** (U6) A ⊉ "Kanti Sweets" — ever, in any tier.
**N2 — No absent-scene leak [P1].** (U3) A ⊉ any seg content A wasn't stamped into.
**N3 — No thought leak [P1].** (E1) Sh,S ⊉ A's inner thought.
**N4 — No DM-content leak [P2].** (U7/U8) non-participant ⊉ DM content.
**N5 — No rollup leak [P3].** (U10) A ⊉ seg2 content via any arc/chapter fragment (sharp tiers).
**N6 — No unreal leak [P0].** (E3) reality-tagged content ⊉ every memory.
**N7 — No divergence [P1].** (U2) Sh's and A's memory of a shared scene agree on facts (one objective summary).
**N8 — Input-filtering enforced [P1] (unit).** the summarizer call for a group RECEIVES ONLY that
group's messages — assert chatcompile never passes out-of-group/private msgs into a group summary.
**N9 — Canonicalization can't fail-open a secret [P0] (unit).** a stamped private msg whose audience
names differ in case/format from card names must STILL filter correctly (shared canonical map) —
assert it does NOT silently become visible to everyone.
**N10 — No spurious shell [P2].** (E4) no "a whisper happened" entry when there was no excluded observer.
**N11 — Fail-open is loud, not silent [P0].** an UNSTAMPED message that the detectors flag as likely
private (whisperDetect/markup) is surfaced/logged, not silently shared. (Guards: stamp-quality dependency.)

## D. CROSS-CHAT / PERSISTENCE [P4]

**X1 — Recall across chats (same world+char).** memory written in chat-1 is retrievable in chat-2 for Sh.
**X2 — Pre-switch tail flush.** last ~20 msgs of the OUTGOING chat are captured before switching
(fires on the chat being left, not the one entered).
**X3 — World-bound auto-load.** `<World> - Memories` loads for a new chat in the world with no manual switch.
**X4 — Late joiner.** a char absent from earlier chats has no memory of them; only chats they were in.

## E. RETRIEVAL / HIERARCHY [P4]

**R1 — Semantic recall.** a turn about "the sweet shop" pulls the relevant memory by meaning (vector top-k),
then witness-filtered to the responder. (For A this returns the shell, never the content.)
**R2 — Tier bias.** recent context favors leaf scenes; distant favors rollups.
**R3 — Budget + filter order.** retrieve top-k, THEN witness-filter, THEN trim to budget — and witness-filter
is never skipped under budget pressure. (Guards: budget can't bypass witness.)

---

## How this is used
- **N-series + U6/U10 are the gate:** Phase 0 ships with these as RED tests; no phase is "done"
  until its tagged scenarios are green and stay green (permanent regression suite).
- Fixtures double as the bug repro for the original blocker (U6/N1) so it can't silently return.
- Extensible: add domain scenarios (e.g., overheard-through-a-door, lying/false statement → belief
  is Plane 2, group split into two rooms) as they come up.
