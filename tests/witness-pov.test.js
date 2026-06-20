// tests/witness-pov.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCompiledSceneForCharacter, messageWitnessedBy } from '../witnessScope.js';

// Helper: build a compiledScene that references chat indices (as compileScene does).
const sceneOf = (chat) => ({
    messages: chat.map((_, i) => ({ id: i })),
    metadata: { messageCount: chat.length },
});
const ids = (scene) => scene.messages.map(m => m.id);

// U6/N1 — whisper: S→Sh "Kanti Sweets" while A is present.
test('U6/N1 whisper: Aisha is NOT fed the whisper content; Shilpa is', () => {
    const chat = [
        { name: 'Sachin', is_user: true,  mes: 'walking home',           extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } }, // 0 room
        { name: 'Sachin', is_user: true,  mes: 'the shop is Kanti Sweets', extra: { channel: { audience: ['sachin', 'shilpa'] } } },          // 1 whisper→Sh
        { name: 'Aisha',  is_user: false, mes: 'what are you whispering?',  extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } }, // 2 room
    ];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')),  [0, 2], 'Aisha must not be fed msg 1 (the whisper)');
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Shilpa')), [0, 1, 2], 'Shilpa witnessed all three');
    assert.equal(messageWitnessedBy(chat[1], 'Aisha'), false, 'N1: Aisha did not witness the whisper content');
});

// U2 — full-group room scene: everyone present is fed everything.
test('U2 full group: all present chars fed the whole scene', () => {
    const chat = [
        { name: 'Shilpa', is_user: false, mes: 'hi',  extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } },
        { name: 'Aisha',  is_user: false, mes: 'hey', extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } },
    ];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Shilpa')), [0, 1]);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')),  [0, 1]);
});

// U3/N2 — absent character is fed nothing from a scene they missed.
test('U3/N2 absent: a char not in any audience is fed nothing', () => {
    const chat = [
        { name: 'Sachin', is_user: true,  mes: 'just us', extra: { channel: { audience: ['sachin', 'shilpa'] } } },
        { name: 'Shilpa', is_user: false, mes: 'yes',     extra: { channel: { audience: ['sachin', 'shilpa'] } } },
    ];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')), [], 'Aisha was absent → empty slice');
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Shilpa')), [0, 1]);
});

// U5 — exit/return mid-scene: char recalls only the segments they were in.
test('U5 exit mid-scene: Aisha gets seg1+seg3, not seg2', () => {
    const chat = [
        { name: 'Aisha',  is_user: false, mes: 'seg1', extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } }, // 0
        { name: 'Shilpa', is_user: false, mes: 'seg2', extra: { channel: { audience: ['sachin', 'shilpa'] } } },          // 1 (A out)
        { name: 'Aisha',  is_user: false, mes: 'seg3', extra: { channel: { audience: ['sachin', 'shilpa', 'aisha'] } } }, // 2
    ];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')), [0, 2]);
});

// N3 — private inner thought: only the thinker is fed it.
test('N3 inner thought: only the thinker witnesses it', () => {
    const chat = [
        { name: 'Aisha', is_user: false, mes: '(*she wonders if he noticed*)', extra: { channel: { audience: ['aisha'] } } },
    ];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')),  [0]);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Shilpa')), []);
});

// E?/fail-open — unstamped message is witnessed by everyone.
test('fail-open: an unstamped message is fed to everyone', () => {
    const chat = [{ name: 'Shilpa', is_user: false, mes: 'no stamp', extra: {} }];
    const scene = sceneOf(chat);
    assert.deepEqual(ids(filterCompiledSceneForCharacter(scene, chat, 'Aisha')), [0]);
});

// U6 SHELL — Aisha should still learn "a whisper happened" (NOT the content).
// Requires the shell mechanism (Phase 2). Locked here as the Phase-2 gate.
test('U6 shell: Aisha learns a whisper occurred (no content)', { skip: 'Phase 2 — shell mechanism not built' }, () => {
    assert.fail('implement in Phase 2');
});

// Phase-1a coverage pointer — wiring covered by plane1.test.js + integration review.
test('Phase 1a: objective single-segment witness gate is covered by tests/plane1.test.js', () => {
    // U1/U2/N2 + drop-unreal + dead-filter + fail-open/closed are exercised in plane1.test.js
    // against computePlane1Memory (the pure witness heart). Live ST wiring (book routing,
    // populateLorebookEntry stamp) is verified by the final review + manual smoke in SillyTavern.
    assert.ok(true);
});
test('U4/U5/E9 enter-exit segmentation', { skip: 'Phase 1b — audience segmenter not built' }, () => {});
test('U6 shell: whisper-occurred-without-content', { skip: 'Phase 2 — shell mechanism not built' }, () => {});
