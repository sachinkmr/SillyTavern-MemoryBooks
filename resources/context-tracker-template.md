# Context Tracker — Per-Character POV Template (v2)

Use these as the **Prompt** and **Response Format** fields when creating a side prompt template with per-character mode enabled.

Optimized for thinking models (Gemma 4 31B-IT, DeepSeek V3.2). Reasoning instructions map to the thinking phase; output format is a clean template the model fills in.

---

## Prompt

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

---

## Response Format

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
