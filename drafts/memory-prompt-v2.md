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

For the keywords field, generate 10-20 retrieval keywords using a DUAL-LAYER strategy. Keywords serve two retrieval systems simultaneously: (1) substring matching against chat messages, and (2) vector/semantic similarity search. You must include keywords that work for BOTH.

LAYER 1 — SIMPLE TRIGGER WORDS (5-8 keywords):
Short, concrete, 1-2 word keywords that characters would ACTUALLY TYPE in future messages when referencing this scene. These trigger substring matching.
- Must be 1-2 words maximum
- Must be concrete nouns, verbs, or short phrases that naturally appear in conversation
- Ask: "Would a character plausibly type this word when referencing this scene?"
- Examples: "date", "roti", "fire and ice", "GPS tracker", "parking lot", "blue balls", "condom"
- It is OK if a simple keyword appears in 2-3 other entries — substring matches are ranked by vector similarity, so the most relevant entry wins. But avoid keywords that would match 5+ entries.

LAYER 2 — SIGNATURE PHRASES (5-8 keywords):
Longer, descriptive phrases (2-5 words) that capture the scene's unique identity for semantic/vector search.
- Distinctive quotes, metaphors, coined terms, or named events unique to this scene
- Scene-specific details that pin this moment
- Examples: "load-bearing wall metaphor", "never experienced a date", "kitchen floor reconciliation", "first roti puffs perfectly"

WHAT TO AVOID:
- Character names ({{char}}, {{user}}) — these match everything
- Abstract emotions or themes (intimacy, vulnerability, trust, cowardice, control, silence, warmth, surrender, exhaustion)
- Generic body parts (neck, wrist, collarbone, thigh, pulse, sternum) — unless modified to be scene-specific
- Recurring environmental details that appear in most scenes (mattress, lamplight, bedsheets, headboard, bedroom, living room)
- DO NOT make all keywords compound phrases — if every keyword is 3+ words, none will substring-match actual chat messages. At least half your keywords must be 1-2 words.

DEDUPLICATION: If PREVIOUS SCENE CONTEXT is provided above, scan the keywords listed there. Do NOT reuse any keyword that already appears in a previous entry, unless this scene gives that keyword a fundamentally different meaning. Instead, find what makes THIS scene different from those previous scenes and keyword THAT.

Return ONLY the JSON, no other text.
```
