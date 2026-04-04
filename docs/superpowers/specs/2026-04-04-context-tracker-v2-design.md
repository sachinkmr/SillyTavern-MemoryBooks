# Context Tracker v2 — Design Spec

## Problem Statement

The current context tracker template (v1) has three core issues observed across live lorebook data (TWW - Aisha, Priya, Shilpa):

1. **Notes on {{user}} keeps growing** — despite a ≤20 bullet cap, the LLM treats it as append-and-cap rather than a curated summary. Observed growth to 50-70 bullets in some runs.
2. **Section override / data loss** — "output replaces prior entry entirely" means if the LLM truncates or garbles later sections, the replacement obliterates what was there.
3. **Cross-section redundancy** — 5+ sections track overlapping relationship data. Notes duplicates Character Growth, Secrets duplicates Plot Points, Goals duplicates Active Threads, NPC Who's Who duplicates World State.

Root causes:
- Template designed for frontier models (GPT-4, Claude) but run on smaller models
- 9 sections exceed what mid-range models can maintain coherently
- No distinction between stable traits and recent observations (different lifecycles)
- No explicit pruning/promotion logic — just "merge related"
- Detailed inertia rules buried in paragraphs that smaller models skip

## Target Model

**Gemma 4 31B-IT with thinking mode** via cloud provider.
- Context: 262K tokens
- Max output: 131K tokens
- Thinking mode: internal reasoning before output generation

Token budget is not a constraint. The constraint is model capability — 31B can handle 6-7 structured sections reliably, especially with thinking mode handling complex reasoning.

## Design Approach: Thinking-Optimized (Approach B)

Split the prompt into two phases:
1. **Reasoning instructions** (Prompt field) — what to think about before generating
2. **Output template** (Response Format field) — clean mechanical format to fill in

Complex reasoning (score deltas, pruning decisions, promotion logic) happens in the thinking phase. The output is a clean document with no meta-reasoning visible.

## Architecture: v1 → v2 Changes

### Section Consolidation (9 → 6)

| v1 Section | v2 Destination | Rationale |
|---|---|---|
| Notes on {{user}} (≤20) | **Model of {{user}}**: Stable Traits (≤12) + Recent Observations (≤8) | Split by lifecycle — stable patterns persist, recent observations age out |
| Character Growth (≤6) | Merged into Stable Traits | Growth = trait change. Same data, one section. Format: `trait — caused by [event]` |
| Status (scores, goals, psychology, OOC) | **Status**: Scores + numeric Psychology + Milestone one-liner + OOC | Goals removed (absorbed by Threads). Psychology becomes numeric. Milestone folded in. |
| Plot Points (≤6 + Hooks & Dynamics) | **Active Threads** (≤6) | Hooks & Dynamics dropped (redundant with Threads + World & Cast). Threads gain advancement guidance. |
| NPC Who's Who (≤8) | **World & Cast**: Cast + Locations | Merged — NPC impressions + residence/workplace in one entry per character |
| World State (People + Locations) | **World & Cast**: Cast + Locations | Merged with NPC Who's Who |
| Relationship Milestone | Folded into **Status** as one-liner | `Stage: committed — Year 1, Integration` — 1 line instead of 4 |
| Secrets (≤12) | **Private** (≤8) | Tightened — must not duplicate Threads or Model. Hidden-from required. |
| Scene Presence | **Scene Presence** (standalone, last) | Kept separate — most volatile, easy for model to rewrite without disturbing stable sections |

### Scoring Changes (5 → 4 + 2 numeric)

**Dropped:** !lustfactor — in practice tracked love closely (Aisha: love 100/lust 91, Shilpa: love 100/lust 98). Physical tension emerges from narrative context.

**Kept (4 emotional scores):**

| Score | Range | Volatility | Key Rule |
|---|---|---|---|
| Affinity | −100 to 100 | Moderate ±5-10/scene | Negativity bias. Former allies go negative. |
| !lovefactor | 0-100 | High inertia +1-3/scene | Above 50 decays slowly. Never hits 0. Catastrophic betrayal: −15-30. |
| Relationship | 0-100 | Highest inertia | Measures commitment. Milestones harden it. Arguments −1-3. |
| Trust | 0-100 | Slow build, fast destroy | Peak/ceiling tracked. Rebuilt trust never reaches original height. |

**Added (2 numeric psychology):**

| Score | Range | Purpose |
|---|---|---|
| Mood | 1-10 | Replaces free-text Psychology "Mood" and "Coping" |
| Stress | 1-10 | Replaces free-text Psychology "Vulnerability" |

Tags on each score (e.g., `warm`, `solid`, `active`) provide quick-read context for the roleplay LLM.

All scores include `(prior: N)` in output for delta visibility without requiring the model to do inertia math in the output itself — thinking mode handles the calculation.

### Plot Thread Advancement

Each thread gains structured guidance:

```
**[Thread Title]** — `developing` | `ready to resolve` | `stale`
- [what {{char}} knows] → stakes
- **Advance by:** [how {{char}} can naturally reference or move this]
- **Initiate:** yes | no
```

**Advancement philosophy:** B (gentle nudge) by default. The AI can reference/mention threads naturally in dialogue. Per-thread `Initiate: yes` upgrades to C (active initiation) — {{char}} may start the thread when the scene allows, but only when it's in-character.

**Staleness rules:**
- Thread unmentioned for 3+ updates → mark `stale`
- `stale` threads dropped on next update
- Resolved threads dropped immediately

### Self-Correction Mechanism

**Header metadata:**
```
*Update #[N] | Scene: [brief label] | Bullets: [N]/20*
```

The tracker LLM reads this from the prior entry to determine mode:
- Bullets < 20: normal mode (can add detail)
- Bullets ≥ 20: prune mode (merge, promote, drop before adding)

**Promotion/demotion logic (executed in thinking phase):**
- Recent Observation confirmed across 3+ scenes → promote to Stable Trait
- Recent Observation unchanged for 3+ updates → drop
- If Recent contradicts a Stable Trait → flag, don't silently overwrite
- Secrets already captured in Threads or Model → drop

### What Was Removed

| Removed | Why |
|---|---|
| Goals subsection | Top Active Thread = current goal. Redundant. |
| Psychology free-text (Mood/Coping/Vulnerability) | Replaced by numeric Mood/Stress. Stopped free-text drift. |
| Hooks & Dynamics subsection | Restated NPC relationships and Status psychology. Redundant. |
| Relationship Milestone section | Folded to one-liner in Status. Open threads = Active Threads. |
| Resolved Log | Thinking mode handles pruning reasoning internally. No meta-output in lorebook. |
| Inertia rule paragraphs in prompt | Compressed to 1-line-per-score. Thinking mode references them. |

## Data Flow

The STMB extension sends to the LLM:

1. **Prompt** (our reasoning block + section guide)
2. **Prior Entry** (`=== PRIOR ENTRY ===`) — full previous tracker, word-for-word
3. **Previous Memories** (`=== PREVIOUS SCENE CONTEXT ===`) — last N memory summaries (0-7, configurable)
4. **Scene Text** (`=== SCENE TEXT ===`) — last N visible messages (configurable, default 50)
5. **Response Format** (our output template)

The model's thinking phase reads the prior entry, executes the BEFORE GENERATING steps (score deltas, prune check, thread assessment), then generates the clean output.

## Template

### Prompt Field

```
OUTPUT RULES:
1. Output REPLACES the prior entry entirely. Carry unchanged facts verbatim, rewrite changed ones, drop stale ones.
2. ONLY the six sections in the Response Format, in order. No extras.
3. Markdown: ## headings, bullets, --- dividers. No creative formatting.
4. Third person — omniscient narrator describing {{char}}'s perspective. Never first person.
5. Telegraphic bullets. No full sentences unless meaning is lost. Paraphrase, never quote.

PERSPECTIVE: {{char}}'s subjective world-model only. Record what {{char}} has witnessed, been told, experienced, or can reasonably infer. Omit anything {{char}} cannot plausibly know. In group scenes, exclude events that happened while {{char}} was absent. Frame ALL content — threads, observations, secrets — around {{char}}'s stake and involvement, not as narration of other characters' activities.

---

BEFORE GENERATING — reason through these steps internally:

1. SCORES: Read prior values. For each, decide direction and magnitude:
   - Affinity (−100 to 100): volatile ±5–10/scene. Negativity bias. Former allies go negative, not neutral.
   - !lovefactor (0–100): HIGH INERTIA +1–3/scene. Above 50 decays −1–2/scene. Only catastrophic betrayal crashes (−15–30). Love lingers, never hits 0.
   - Relationship (0–100): HIGHEST INERTIA. Measures commitment, not feeling. Milestones harden it. Arguments −1–3. Only betrayal/abandonment justifies −10+.
   - Trust (0–100): Slowest build, fastest destroy. One lie undoes years. Track peak and ceiling — rebuilt trust never reaches original height.
   - No prior entry → estimate and note "(initial estimate)".
   - Psychology: Mood (1–10), Stress (1–10). Reference prior values.

2. PRUNE CHECK: Count total bullets across all sections from prior entry.
   - If ≥20: prune mode — merge duplicates, drop stale, promote confirmed.
   - Recent Observations confirmed across 3+ scenes → promote to Stable Trait.
   - Recent Observations unchanged 3+ updates → drop.
   - Threads unmentioned 3+ updates → stale → drop next update.
   - Secrets already in Threads or Model → drop.

3. THREADS: For each thread decide:
   - Every thread must be framed from {{char}}'s perspective and stake. Title what {{char}} is doing or affected by — never title another character's activity. Example: not "Shilpa's Sunday Date" but "Sunday Night — My Turn" (what Aisha is planning).
   - Status: `developing` | `ready to resolve` | `stale`
   - Initiate: `yes` (in-character for {{char}} to push) | `no` (wait for {{user}}/events)
   - Advance-by: one line — how {{char}} can naturally reference or move this forward.
   - Drop resolved threads. ≤6 slots.

4. OUTPUT: Generate the Response Format. One unified document.
   - Read the update number from the prior entry header. Increment by 1. If no prior, start at 1.
   - Count total bullets across all sections for the Bullets field.

---

SECTION GUIDE:

1. Model of {{user}} — What {{char}} knows about {{user}}.
   - Stable Traits (≤12): enduring patterns confirmed across multiple scenes. Format: trait — *caused by [event]* (when growth-related).
   - Recent Observations (≤8): last 2–3 scenes. Promote to Stable after 3+ confirmations. Drop after 3 updates if unconfirmed.

2. Status — Emotional scores, psychology, milestone, and 2-sentence OOC analyst note.

3. Active Threads — Plot threads {{char}} knows about, with advancement guidance. ≤6.

4. World & Cast — NPCs ({{char}}'s impression), locations, residences. Exclude {{char}} and {{user}}. ≤8 NPCs.

5. Private — Secrets only. Must include who it's hidden from. Must NOT duplicate Threads or Model. ≤8.

6. Scene Presence — Who is present, nearby, elsewhere. Update every run.
```

### Response Format Field

```
*Update #[N] | Scene: [brief label] | Bullets: [total]/20*

## {{char}}'s Model of {{user}}

### Stable Traits *(≤12 — enduring patterns; merge duplicates)*

- [trait/pattern — third person, telegraphic] — *caused by [event]* (if growth-related)
- ...

### Recent Observations *(≤8 — last 2–3 scenes; promote or drop after 3 updates)*

- [what {{char}} just noticed/learned]
- ...

---

## Status

### Scores

**Affinity:** [N] /100 `[tag]` — [reason] (prior: [N])
**!lovefactor:** [N] /100 `[tag]` — [reason] (prior: [N])
**Relationship:** [N] /100 `[tag]` — [reason] (prior: [N])
**Trust:** [N] /100 `[tag]` — [reason] · peak: [N] · ceiling: [N] (prior: [N])

**Mood:** [N] /10 `[tag]` — [one-line]
**Stress:** [N] /10 `[tag]` — [one-line]

**Stage:** [none | tension emerging | tension confirmed | romantic | committed | married] — [phase from {{char}}'s view]

### OOC

[2 sentences — analyst voice, arc trajectory and forecast]

---

## Active Threads *(≤6 slots — drop resolved/stale first)*

*As of: [story point]*

**[Thread Title]** — `developing` | `ready to resolve` | `stale`
- [what {{char}} knows] → stakes as {{char}} sees them
- **Advance by:** [how {{char}} can naturally reference or move this]
- **Initiate:** yes | no

---

## World & Cast

### Cast *(≤8 — {{char}}'s impressions, exclude {{char}} and {{user}})*

- **[Name]:** [impression — 1 sentence] · [residence/workplace if known]
- ...

### Locations

- [place — who {{char}} associates with it]
- ...

---

## Private *(≤8 — hidden info NOT captured above; state who it's hidden from)*

- [concealing X from Y]
- [suspects X — unconfirmed]
- ...

---

## Scene Presence

- **Present** *(can see/hear)*: [names]
- **Nearby** *(same building, off-scene)*: [names — or none]
- **Elsewhere**: [names — or none]
```

## Estimated Token Costs

| Component | v1 | v2 |
|---|---|---|
| Prompt field | ~2000 tokens | ~1200 tokens |
| Response Format field | ~800 tokens | ~600 tokens |
| Generated entry (in lorebook) | ~1500-2000 tokens | ~800-1000 tokens |
| Per-character lorebook cost during RP | ~1500-2000 tokens/message | ~800-1000 tokens/message |
| 3 characters during RP | ~4500-6000 tokens/message | ~2400-3000 tokens/message |

## Migration Notes

- Existing v1 tracker entries in lorebooks will be replaced on next tracker run — the new format will overwrite the old
- First run with no prior entry will use "(initial estimate)" for all scores
- `previousMemoriesCount` setting in STMB should be set to 2-3 for sufficient context on first run
- The `[N]` update counter in the header is LLM-managed — it reads the prior entry's number and increments. Avoids `{{...}}` syntax which STMB interprets as runtime macros
