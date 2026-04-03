# Memory Prompt v2 — Keyword-Focused Rewrite

**Purpose**: Drop-in replacement for the "sumup" preset. Same JSON structure + content format, completely rewritten keyword instructions.

**Key changes from existing sumup**:
- Added structured Timeline section with exact dates/times and chronological event listing
- Added structured sections (Story Beats, Key Interactions, Character Developments, Outcome) replacing freeform narration
- Reduced keyword count: 10-20 (was 15-30)
- Added uniqueness test: "would this keyword fire for 3+ other scenes?"
- Added tiered keyword strategy: signature > distinctive > anchoring
- Added dedup against PREVIOUS SCENE CONTEXT keywords
- Added retrieval-simulation framing
- Expanded stop-list with dynamic detection guidance
- Added concrete examples of good vs bad keywords

---

## Prompt Text

```
Analyze the following roleplay scene and return a beat summary as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Comprehensive beat summary...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, write a comprehensive beat summary that captures this scene completely. Use this structure:

# Scene Summary - Day X - [Title]

## Timeline
- **Period**: [Start date/time] → [End date/time] (use exact dates if known, e.g., "March 13, 2026, 11:16 PM → 11:31 PM")
- List key events in strict chronological order within this scene
- Format: "[Time/Moment]: [Event description]" (e.g., "11:20 PM: Character A confronts Character B about the letter")
- Note any time skips, flashbacks, or simultaneous events explicitly

## Story Beats
Narrate ALL important story beats/events that happened, in chronological order. Capture clear cause-effect logic: what triggered what, and why it mattered.

## Key Interactions
Key interaction highlights, notable details, memorable quotes (attributed and exact when possible).

## Character Developments
How each character's motives, emotions, or relationships shifted during this scene.

## Outcome
Resulting decisions, emotional states, consequences, unresolved threads, and anything that affects future continuity.

Ensure no important information is lost. [OOC] conversation/interaction is not useful for summaries and should be ignored and excluded.

For the keywords field, generate 10-20 retrieval keywords following these rules:

PURPOSE: Each keyword is a retrieval trigger stored in a lorebook entry. When this keyword appears in future roleplay messages, this memory activates and is injected into context. Ask yourself for each keyword: "If this word appears in a future message, should THIS specific scene activate — and not dozens of others?"

UNIQUENESS TEST: Before including any keyword, ask: "Could this keyword match 3 or more other scenes in this story?" If yes, it is too generic — drop it or make it more specific. A keyword that fires everywhere is worse than no keyword at all.

Generate keywords in three tiers:

SIGNATURE KEYWORDS (3-5): The highest-value tier. These are phrases, metaphors, distinctive quotes, named events, or coined terms that are UNIQUE to this scene. If a character says something memorable or a concept is introduced for the first time, capture it. Examples of good signature keywords: "load-bearing wall", "forget my name challenge", "no more performances", "pack for forever".

DISTINCTIVE DETAILS (4-8): Specific physical objects, actions, or sensory details that are notable IN THIS SCENE — not recurring backdrop. Apply this filter: if this detail appears in most scenes of this story, skip it. A "headboard" in every bedroom scene is noise; a "plastic stool in the shower" or "cardamom tea tray" is signal because it pins a specific moment.

ANCHORING CONTEXT (2-4): Location or time markers ONLY when they help distinguish this scene from others. If the story takes place mostly in one location, that location name is NOT a useful keyword. Include locations and times only when they are unusual or first-time for the story.

WHAT TO AVOID:
- Character names ({{char}}, {{user}}) — these match everything
- Abstract emotions or themes (intimacy, vulnerability, trust, cowardice, control, silence, performance, practice, sanctuary, warmth, surrender, exhaustion)
- Generic body parts (neck, wrist, collarbone, thigh, pulse, sternum) — unless they are modified to be scene-specific (e.g., "bite mark scar below ribcage" is specific; "collarbone" alone is not)
- Recurring environmental details that appear in most scenes (mattress, lamplight, bedsheets, headboard, bedroom, living room, scent, whisper, kiss)
- Compound micro-summaries ("rough sex negotiation", "ankle healing countdown") — keywords should be 1-3 words

DEDUPLICATION: If PREVIOUS SCENE CONTEXT is provided above, scan the keywords listed there. Do NOT reuse any keyword that already appears in a previous entry, unless this scene gives that keyword a fundamentally different meaning. Instead, find what makes THIS scene different from those previous scenes and keyword THAT.

Return ONLY the JSON, no other text.
```
