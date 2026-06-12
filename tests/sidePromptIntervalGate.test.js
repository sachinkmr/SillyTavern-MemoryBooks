// Per-character interval gate: the fire/skip decision for an onInterval side
// prompt must be evaluated PER CHARACTER against THAT character's own
// checkpoint — the suffixed title and STMB_sp_<key>_<Char>_lastMsgId key the
// writer uses. Live-found 2026-06-12: the gate read the UN-suffixed
// template-level checkpoint, never found the per-character checkpoint it had
// written, fell back to baseline -1, and so re-fired the per-character LLM
// call on EVERY received message instead of every `visibleMessages` (20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    perCharacterCheckpointKey,
    perCharacterLookupTitles,
    resolveCharacterCheckpoint,
    shouldFireForCharacter,
} from '../sidePromptIntervalGate.js';

// Mirrors getSidePromptTitleSuffix() in sidePrompts.js.
const SUFFIX = ' (STMB SidePrompt)';
const unifiedTitle = (tpl) => `${tpl.name}${SUFFIX}`;
const perCharTitle = (base, charName) => {
    const stripped = base.endsWith(SUFFIX) ? base.slice(0, -SUFFIX.length) : base;
    return `${stripped} [${charName}]${SUFFIX}`;
};

const TPL = {
    name: 'Actor Tracker',
    key: 'actor-tracker',
    triggers: { onInterval: { visibleMessages: 20 } },
};

// All messages visible (no is_system) so visibleSince == index span.
const visibleChat = (n) => Array.from({ length: n }, (_, i) => ({ name: 'x', mes: String(i), is_system: false }));

// Build a lorebook whose ONLY checkpoint is Aisha's per-character entry at endId.
function loreWithAishaCheckpoint(endId, lastRunAt = null) {
    const title = perCharTitle(unifiedTitle(TPL), 'Aisha');
    const entry = {
        comment: title,
        content: 'aisha tracker',
        [perCharacterCheckpointKey(TPL.key, 'Aisha')]: endId,
    };
    if (lastRunAt) entry[`STMB_sp_${TPL.key}_Aisha_lastRunAt`] = lastRunAt;
    return { entries: { 0: entry } };
}

test('checkpoint key derives the per-character suffix (matches the writer)', () => {
    assert.equal(perCharacterCheckpointKey('actor-tracker', 'Aisha'), 'STMB_sp_actor-tracker_Aisha_lastMsgId');
    // Derived from the character, never hardcoded:
    assert.equal(perCharacterCheckpointKey('actor-tracker', 'Shilpa'), 'STMB_sp_actor-tracker_Shilpa_lastMsgId');
});

test('lookup titles include the suffixed per-character title (matches the writer)', () => {
    const titles = perCharacterLookupTitles(TPL, 'Aisha', { unifiedTitle, perCharTitle });
    assert.ok(titles.includes('Actor Tracker [Aisha] (STMB SidePrompt)'),
        `expected per-character title in ${JSON.stringify(titles)}`);
});

test('resolveCharacterCheckpoint finds Aisha\'s own checkpoint, not template baseline', () => {
    const lore = loreWithAishaCheckpoint(70);
    const cp = resolveCharacterCheckpoint(lore, TPL, 'Aisha', { unifiedTitle, perCharTitle, baseline: -1 });
    assert.equal(cp.lastMsgId, 70);
});

// THE BUG (negative case): Aisha checkpointed at msg 70, chat now ends at 73
// (only 3 new visible messages < 20). The gate MUST NOT fire for Aisha.
test('does NOT fire for Aisha when <20 visible messages since her checkpoint', () => {
    const lore = loreWithAishaCheckpoint(70);
    const chat = visibleChat(74); // indices 0..73, currentLast = 73
    const fired = shouldFireForCharacter({
        lore, tpl: TPL, charName: 'Aisha', chat,
        currentLast: 73, now: Date.now(),
        deps: { unifiedTitle, perCharTitle, baseline: -1 },
    });
    assert.equal(fired, false, 'gate must not fire: only 3 new messages since Aisha checkpoint 70');
});

// Positive case: 20+ new visible messages since Aisha's checkpoint ⇒ fires.
test('fires for Aisha when >=20 visible messages since her checkpoint', () => {
    const lore = loreWithAishaCheckpoint(70);
    const chat = visibleChat(91); // indices 0..90, currentLast = 90 ⇒ 20 new (71..90)
    const fired = shouldFireForCharacter({
        lore, tpl: TPL, charName: 'Aisha', chat,
        currentLast: 90, now: Date.now(),
        deps: { unifiedTitle, perCharTitle, baseline: -1 },
    });
    assert.equal(fired, true, 'gate must fire: 20 new messages since Aisha checkpoint 70');
});

// A second present character (Shilpa) with NO checkpoint is gated independently
// of Aisha: falls back to baseline, so a fresh chat fires; with her own recent
// checkpoint she is held off even while Aisha would fire.
test('characters are gated independently against their own checkpoints', () => {
    const title = perCharTitle(unifiedTitle(TPL), 'Shilpa');
    const lore = {
        entries: {
            0: {
                comment: perCharTitle(unifiedTitle(TPL), 'Aisha'),
                [perCharacterCheckpointKey(TPL.key, 'Aisha')]: 50, // far back ⇒ Aisha fires
            },
            1: {
                comment: title,
                [perCharacterCheckpointKey(TPL.key, 'Shilpa')]: 88, // recent ⇒ Shilpa holds
            },
        },
    };
    const chat = visibleChat(91); // currentLast = 90
    const deps = { unifiedTitle, perCharTitle, baseline: -1 };
    const aishaFires = shouldFireForCharacter({ lore, tpl: TPL, charName: 'Aisha', chat, currentLast: 90, now: Date.now(), deps });
    const shilpaFires = shouldFireForCharacter({ lore, tpl: TPL, charName: 'Shilpa', chat, currentLast: 90, now: Date.now(), deps });
    assert.equal(aishaFires, true, 'Aisha (checkpoint 50, 40 new) should fire');
    assert.equal(shilpaFires, false, 'Shilpa (checkpoint 88, 2 new) should NOT fire');
});

// Per-character debounce: a recent lastRunAt for THIS character suppresses the
// fire even when the message threshold is met.
test('per-character debounce suppresses fire within the debounce window', () => {
    const now = Date.now();
    const lore = loreWithAishaCheckpoint(50, new Date(now - 2000).toISOString()); // 2s ago < 10s
    const chat = visibleChat(91); // 40 new ≥ 20
    const fired = shouldFireForCharacter({
        lore, tpl: TPL, charName: 'Aisha', chat,
        currentLast: 90, now,
        deps: { unifiedTitle, perCharTitle, baseline: -1 },
    });
    assert.equal(fired, false, 'debounce (2s < 10s) must suppress the fire for Aisha');
});

// Regression: non-perCharacter interval templates keep the existing
// template-level checkpoint semantics. The same gate primitive, given a
// template-level checkpoint resolver, must fire/hold exactly as before.
test('non-perCharacter template gates on its own template-level checkpoint', () => {
    const ntpl = { name: 'Scoreboard', key: 'scoreboard', triggers: { onInterval: { visibleMessages: 20 } } };
    // Template-level entry (no [Char] suffix), un-suffixed checkpoint key.
    const lore = {
        entries: {
            0: {
                comment: `${ntpl.name}${SUFFIX}`,
                [`STMB_sp_${ntpl.key}_lastMsgId`]: 70,
            },
        },
    };
    const chat = visibleChat(74); // 3 new < 20
    // charName null ⇒ template-level path (no per-character suffix).
    const fired = shouldFireForCharacter({
        lore, tpl: ntpl, charName: null, chat,
        currentLast: 73, now: Date.now(),
        deps: { unifiedTitle, perCharTitle, baseline: -1 },
    });
    assert.equal(fired, false, 'non-perCharacter gate must hold: 3 new < 20 since checkpoint 70');

    const chat2 = visibleChat(91); // 20 new
    const fired2 = shouldFireForCharacter({
        lore, tpl: ntpl, charName: null, chat: chat2,
        currentLast: 90, now: Date.now(),
        deps: { unifiedTitle, perCharTitle, baseline: -1 },
    });
    assert.equal(fired2, true, 'non-perCharacter gate must fire: 20 new since checkpoint 70');
});
