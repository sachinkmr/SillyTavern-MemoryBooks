# Context Tracker — Per-Character POV Template

Use these as the **Prompt** and **Response Format** fields when creating a side prompt template with per-character mode enabled.

---

## Prompt

```
OUTPUT RULES:
1. Output REPLACES the prior entry entirely. Carry unchanged facts verbatim, rewrite changed ones, drop stale ones — one unified document.
2. ONLY the nine sections below, in order. No extras.
3. Markdown: ## headings, bullets, --- dividers. No === markers, no creative headlines.
4. Third person throughout — omniscient narrator describing {{char}}'s perspective. Never first person.
5. Telegraphic bullets. No full sentences unless meaning is lost. Paraphrase, never quote.

PERSPECTIVE: {{char}}'s subjective world-model only. Record what {{char}} has witnessed, been told, experienced, or can reasonably infer. Omit anything {{char}} cannot plausibly know.

Update all nine sections using available context (scenes, memories, lore, interactions).

---

1. {{char}}'s Notes on {{user}}
   What {{char}} has observed, been told, or inferred about {{user}}. Third person.
   LIMIT: ≤20 bullets. Merge related. New replaces old — never stack.

2. Status
   {{char}}'s emotional state toward {{user}} — from {{char}}'s vantage. Include goals and 2-sentence OOC note.

   SCORING RULES — realistic emotional inertia:

   - **Affinity** (general warmth/regard): Range −100 to 100. Strangers start at 0. Moderate volatility — can shift ±5–10 per scene. Negativity bias: bad events hit harder than good ones feel. Former allies who fell out go negative, not neutral.
     Tags: `warm` | `guarded` | `complicated` | `cold` | `hostile`

   - **!lovefactor** (deep emotional bond): Range 0–100. HIGH INERTIA. Builds slowly (+1–3 per scene of genuine connection). Once above 50, decays very slowly (−1–2 per scene of neglect/conflict). Only catastrophic betrayal can crash it (−15–30). Love lingers after breakup — 80 drops to ~60 over many scenes, never to 0. Once someone has been truly loved, the imprint is near-permanent.
     Tags: `active` | `dormant` | `conflicted` | `resentful` | `nostalgic`

   - **!lustfactor** (physical/sexual attraction): Range 0–100. More volatile — can spike (+5–10) on tension, danger, vulnerability. Partially independent of love. Resentment suppresses lust in some, amplifies in others. Disgust from betrayal can kill it permanently.
     Tags: `active` | `suppressed` | `fixated` | `repulsed`

   - **Relationship** (structural bond/commitment): Range 0–100. HIGHEST INERTIA. Measures commitment, not feeling. Shared milestones (moving in, meeting family, shared trauma) make it structurally harder to dissolve. Arguments cost −1–3. Only betrayal, abandonment, or abuse justifies −10+. A single bad scene cannot break what took dozens to build.
     Tags: `stable` | `strained` | `eroding` | `fractured` | `severed` | `rebuilding`

   - **Trust**: Range 0–100. Slowest to build, fastest to destroy. A single lie can undo years. Track peak and ceiling — rebuilt trust never reaches its original height; there is always a scar.
     Tags: `solid` | `tentative` | `damaged` | `broken` | `blind`

   - ALWAYS reference prior values when calculating. If no prior entry, estimate from context and note "(initial estimate)".
   - Calculate adjustments internally (prior → ±change → new), but only output the final value and reason in your response.

3. Character Growth
   How {{char}}'s personality, beliefs, or behavior have shifted due to story events. Compare against {{char}}'s baseline/original characterization. Only note changes supported by scenes {{char}} experienced.
   LIMIT: ≤6 bullets. Each: what changed → caused by what event. Drop reverted changes.

4. Plot Points
   Threads {{char}} is aware of — witnessed, told, or involved in. Exclude events outside {{char}}'s knowledge.
   LIMIT: ≤6 active threads. Drop resolved/stale before adding.

5. NPC Who's Who
   NPCs {{char}} has met or has credible knowledge of. {{char}}'s impression, not objective truth. Exclude {{char}} and {{user}}.
   LIMIT: ≤8 NPCs by relevance to {{char}}.

6. World State
   Locations, residences, workplaces as {{char}} understands them. Firsthand or trusted sources only.

7. Relationship Milestone
   Where {{char}} perceives the relationship stands. Advance stage only when clearly supported by multiple recent scenes. Conservative default.

8. Secrets
   Secrets {{char}} holds, has been told, or suspects. Note who each is hidden from. Exclude secrets {{char}} doesn't know exist.
   LIMIT: ≤12 bullets total across sub-sections.

9. Scene Presence
   Who {{char}} perceives present, nearby, or elsewhere in current scene. Update every run.
```

---

## Response Format

```
## {{char}}'s Notes on {{user}}

*(≤20 — consolidate; never append)*

- [telegraphic, third person, {{char}}'s direct knowledge only]
- ...

---

## Status

### Emotional Scores

**Affinity:** [N] /100 `[tag]` — [reason for current value]
**!lovefactor:** [N] /100 `[tag]` — [reason for current value]
**!lustfactor:** [N] /100 `[tag]` — [reason for current value]
**Relationship:** [N] /100 `[tag]` — [reason for current value]
**Trust:** [N] /100 `[tag]` — [reason] · peak: [N] · ceiling: [N]

### Goals

- **Short-term:** [what {{char}} wants now]
- **Long-term:** [what {{char}} is working toward]

### Psychology

- **Mood:** [current emotional baseline]
- **Coping:** [how {{char}} handles stress right now]
- **Vulnerability:** [what could break {{char}}'s composure]

### OOC

[2 sentences — analyst voice, arc trajectory and forecast]

---

## Character Growth

*(≤6 — drop reverted; only scene-supported shifts)*

- **[trait/belief/behavior]:** [how it changed] — *caused by [event]*
- ...

---

## Plot Points

*(≤6 active — drop resolved/stale first)*

*As of: [story point]*

**Arc:** [1–2 sentences — narrative as {{char}} understands it]

### Active Threads

**[Thread Title]** — `active`
- [what {{char}} knows] → stakes as {{char}} sees them

**[Thread Title]** — `on hold`
- [what {{char}} knows] → stakes as {{char}} sees them

### Hooks & Dynamics

- **Hooks:** [things {{char}} noticed or was warned about]
- **Dynamics:** [{{char}}'s read on key relationships — 1 line each]

---

## NPC Who's Who

*(≤8 — drop least relevant first)*

- **[Name]:** [{{char}}'s impression — 1 sentence]
- ...

---

## World State

### People

- **[Name]:** [residence] · [workplace] · [notes] *(as {{char}} knows)*
- ...

### Shared Locations

- [place — who {{char}} associates with it]
- ...

---

## Relationship Milestone

- **Arc:** Year [N] — [phase from {{char}}'s view]
- **Stage:** none | tension emerging | tension confirmed | romantic | committed | married
- **Last event:** [1-line — as {{char}} experienced it]
- **Open threads:** [unresolved tensions {{char}} knows of]

---

## Secrets

*(≤12 total across both)*

### {{char}} knows or is hiding

- [concealing X from Y]
- [told X by someone]

### {{char}} suspects but unconfirmed

- [suspicion — 1 line]

---

## Scene Presence

- **Present** *(can see/hear)*: [names]
- **Nearby** *(same building, off-scene)*: [names — or none]
- **Elsewhere**: [names — or none]
```
