// subjectiveSceneFormat.js — PURE (no SillyTavern imports).
//
// The two-plane SUBJECTIVE Scheme B guide injected into side-prompt (tracker)
// prompts so they read the raw witness-filtered chat from {{char}}'s perception.
//
// Why this differs from the OBJECTIVE summarizer guide (stmemory.js SCENE_FORMAT_GUIDE):
// the summarizer is audience-neutral and SKIPS all *italics*. The trackers are
// per-{{char}} SUBJECTIVE, and {{char}}'s OWN italic thoughts are the very source of
// their beliefs / mood / secrets — so the italics rule FLIPS: keep {{char}}'s own
// italics, treat ANOTHER character's italics as unperceived (at most a suspicion).
// One generic block is correct for all three trackers (relationship/world/epistemic).
//
// {{char}} stays a placeholder here; it (and {{user}}) are resolved downstream by
// applySidePromptMacros in sidePrompts.buildPrompt, exactly like the template prompt.

export const SUBJECTIVE_SCENE_FORMAT =
    '## Scene Format (Scheme B) — read the raw chat correctly\n' +
    '- "quotes" = spoken aloud — heard by everyone present.\n' +
    '- > blockquote = remote/written (text, call, DM, letter). {{char}} perceives it ONLY if {{char}} sent or received it. Record it as texted/wrote, not as in-room speech.\n' +
    '- *italics* = a character\'s private unspoken thought:\n' +
    '    - {{char}}\'s OWN -> {{char}}\'s real inner truth — USE it (what {{char}} feels / believes / intends / hides).\n' +
    '    - ANOTHER character\'s -> invisible to {{char}} — NEVER record as something {{char}} knows. At most {{char}} may suspect it from an outward tell.\n' +
    '- (parentheses) = narrator aside — ignore; no one perceives it.\n' +
    '- plain prose = actions / behaviour — observable to those present.\n\n';

/**
 * The block to inject before the scene text, or '' when two-plane is off.
 * Leading '\n' separates it from the preceding prompt section. PURE.
 * @param {*} twoPlaneOn truthy when moduleSettings.twoPlaneMemory is enabled
 * @returns {string}
 */
export function subjectiveSceneFormatBlock(twoPlaneOn) {
    return twoPlaneOn ? '\n' + SUBJECTIVE_SCENE_FORMAT : '';
}
