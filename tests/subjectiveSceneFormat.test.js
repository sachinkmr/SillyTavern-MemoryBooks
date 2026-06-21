// tests/subjectiveSceneFormat.test.js — PURE core for the two-plane subjective
// Scheme B guide injected into side-prompt (tracker) prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECTIVE_SCENE_FORMAT, subjectiveSceneFormatBlock } from '../subjectiveSceneFormat.js';

test('block present when two-plane is ON', () => {
    const b = subjectiveSceneFormatBlock(true);
    assert.match(b, /Scene Format \(Scheme B\)/);
    assert.match(b, /"quotes" = spoken aloud/);
    assert.match(b, /\(parentheses\) = narrator aside/);
    assert.match(b, /plain prose = actions/);
});

test('FLIPPED italics rule: own thought USE; other char NEVER as known (at most suspect)', () => {
    const b = subjectiveSceneFormatBlock(true);
    assert.match(b, /\{\{char\}\}'s OWN/);
    assert.match(b, /USE it/);
    assert.match(b, /ANOTHER character/);
    assert.match(b, /NEVER record as something \{\{char\}\} knows/);
    assert.match(b, /suspect/i);
});

test('remote/blockquote scoped to {{char}} party + recorded as written, not speech', () => {
    const b = subjectiveSceneFormatBlock(true);
    assert.match(b, /> blockquote/);
    assert.match(b, /ONLY if \{\{char\}\} sent or received it/);
    assert.match(b, /texted\/wrote/);
    assert.match(b, /not as in-room speech/);
});

test('carries the {{char}} placeholder for downstream macro resolution', () => {
    assert.match(SUBJECTIVE_SCENE_FORMAT, /\{\{char\}\}/);
});

test('FLAG-OFF: empty string for every falsy input (byte-identical assembly)', () => {
    assert.equal(subjectiveSceneFormatBlock(false), '');
    assert.equal(subjectiveSceneFormatBlock(undefined), '');
    assert.equal(subjectiveSceneFormatBlock(null), '');
    assert.equal(subjectiveSceneFormatBlock(0), '');
    assert.equal(subjectiveSceneFormatBlock(''), '');
});

test('ON output begins with a newline separator then the heading', () => {
    const b = subjectiveSceneFormatBlock(true);
    assert.equal(b.startsWith('\n## Scene Format (Scheme B)'), true);
});
