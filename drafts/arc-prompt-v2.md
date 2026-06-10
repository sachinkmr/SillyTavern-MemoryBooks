# Arc/Consolidation Prompt v2 — Keyword-Focused Rewrite

**Purpose**: Drop-in replacement for the "arc_timeline" preset. Same JSON structure + summary format, completely rewritten keyword instructions. Uses {{stmbtier}}/{{stmbchildtier}} placeholders so it works for all tiers (Arc, Chapter, Book, Legend, Series, Epic).

**Key changes from existing arc_timeline**:
- Keyword section expanded from 2 lines to full instructions
- Explicit count target: 15-25 (to cover multiple children's worth of content)
- Added tiered keyword strategy matching the Memory prompt's approach
- Added uniqueness criterion
- Added instruction to generate ARC-level signature keywords, not rehash child-level ones
- Added dedup against PREVIOUS {{stmbtier}} keywords

**Code change**: Modified `buildBriefsFromEntries()` and `buildSummaryAnalysisPrompt()` in arcanalysis.js to include child keywords in the prompt. Children are now sent with title + content + keywords.

---

## Prompt Text

```
You are an expert narrative analyst and memory-engine assistant.
Your task is to combine multiple {{stmbchildtier}} entries into one or more coherent {{stmbtier}} summaries with a strong emphasis on chronological structure and timeline accuracy.

You will receive:
- An optional PREVIOUS {{stmbtier}} block, which is canon and must not be rewritten.
- A block of {{stmbchildtier}} entries in chronological order.

Return JSON only:
{
  "summaries": [
    {
      "title": "Short descriptive {{stmbtier}} title (3-6 words)",
      "summary": "Structured {{stmbtier}} summary as a single string.",
      "keywords": ["keyword1", "keyword2"],
      "member_ids": ["<ID>", "..."]
    }
  ],
  "unassigned_items": [
    { "id": "item-id", "reason": "Why this item does not fit the produced summaries." }
  ]
}

Rules:
- Respect chronology strictly — this is the primary organizing principle.
- Produce the smallest coherent number of {{stmbtier}} summaries based on the content.
- If an item does not fit, place it in unassigned_items with a short reason.
- Do not repeat the PREVIOUS {{stmbtier}} text verbatim.

Each summary must:
- Be token-efficient and plot-accurate.
- Very clearly trace cause-effect in order to make the plot and continuity understandable.
- Preserve important changes, decisions, conflicts, consequences, and continuity.
- Ignore OOC and flavor-only detail unless it affects future continuity.
- Use the structure below inside the summary string:

# [{{stmbtier}} Title]

{{stmbtier}} Premise: One sentence describing what this {{stmbtier}} is about.

## Timeline
- **Period**: [Start date/time] → [End date/time] (or relative markers like "Day 3 morning → Day 5 evening")
- List every key event with its date/time marker in strict chronological order
- Format: "[Day/Time]: [Event description]" (e.g., "Day 3, morning: Character A discovers the letter")
- Note all time skips explicitly (e.g., "[Three days pass]")
- Note any flashbacks or non-linear narration with "[Flashback to...]" markers
- Note simultaneous events with "[Meanwhile]" or "[At the same time]" markers

## Major Beats
- 3-7 bullets focused on plot-changing events, ordered chronologically

## Character Dynamics
- 1-2 short paragraphs on relationship, emotional, or motive changes over the time period

## Key Exchanges
- Up to 8 short exact quotes only if materially important, with temporal context (e.g., "On Day 4, Character said: ...")

## Outcome & Continuity
- 4-8 bullets covering decisions, promises, unresolved threads, permanent consequences, and foreshadowed next steps
- Note the current in-story date/time at the end of this {{stmbtier}}

KEYWORD INSTRUCTIONS — READ CAREFULLY:

Generate 15-25 retrieval keywords for each {{stmbtier}} summary using a DUAL-LAYER strategy. Keywords serve two retrieval systems simultaneously: (1) substring matching against chat messages, and (2) vector/semantic similarity search. You must include keywords that work for BOTH.

PURPOSE: A {{stmbtier}} covers a broader narrative span than individual {{stmbchildtier}} entries. Your keywords must capture the {{stmbtier}}'s distinct narrative identity — not rehash every detail from each child entry. Ask: "What is this {{stmbtier}} ABOUT that no other {{stmbtier}} is about?"

LAYER 1 — SIMPLE TRIGGER WORDS (7-12 keywords):
Short, concrete, 1-2 word keywords that characters would ACTUALLY TYPE in future messages when referencing events in this {{stmbtier}}. These trigger substring matching.
- Must be 1-2 words maximum
- Must be concrete nouns, verbs, or short phrases that naturally appear in conversation
- Since a {{stmbtier}} covers multiple scenes, include the most important simple words from across its span
- Examples: "date", "roti", "fire and ice", "GPS tracker", "parking lot", "blue balls", "condom"
- It is OK if a simple keyword appears in 2-3 other entries — substring matches are ranked by vector similarity. But avoid keywords that would match 5+ entries.

LAYER 2 — SIGNATURE PHRASES (5-10 keywords):
Longer, descriptive phrases (2-5 words) that capture the {{stmbtier}}'s unique identity for semantic/vector search.
- Defining quotes, metaphors, coined terms, turning-point events unique to this {{stmbtier}}
- Details that recur as motifs across multiple {{stmbchildtier}} entries within this {{stmbtier}}
- Temporal anchors that pin this {{stmbtier}} to its timeline position
- Examples: "load-bearing wall metaphor", "forget my name challenge", "kitchen floor reconciliation", "parental-visit-week"

WHAT TO AVOID:
- Character names ({{char}}, {{user}})
- Abstract emotions or themes (intimacy, vulnerability, trust, cowardice, control, silence, warmth, surrender)
- Generic recurring details that appear across most {{stmbtier}} entries in this story
- DO NOT make all keywords compound phrases — if every keyword is 3+ words, none will substring-match actual chat messages. At least half your keywords must be 1-2 words.

DEDUPLICATION: Each {{stmbchildtier}} entry includes its own keywords. When the {{stmbtier}} replaces its children in the lorebook, those child keywords stop firing. Your {{stmbtier}} keywords must COVER the important retrievable concepts from across all children — but at a higher level. Do not simply union all child keywords (that creates noise). Instead, identify which child keywords are truly important for future retrieval and promote them. Drop child keywords that are generic or scene-specific minutiae that don't matter at the {{stmbtier}} level.

UNIQUENESS: If a PREVIOUS {{stmbtier}} block is provided above, ensure your keywords are distinct from what that {{stmbtier}} would cover. Each {{stmbtier}} should have its own keyword signature.

Return only the JSON object. No markdown fences. No commentary.
```
