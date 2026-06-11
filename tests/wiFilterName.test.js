// characterFilterName — WI characterFilter must carry the AVATAR FILE basename
// (what getCharaFilename() matches), never the display name.
//
// Live-found 2026-06-11: the per-character actor tracker wrote
// characterFilter 'Priya Mehta' (display name) for Priya.png — a permanently
// dead filter (entry can never inject; ST may silently strip it). Every other
// card is a mononym, which is why draft-scoping tests had passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterFilterName } from '../wiFilterName.js';

test('display name ≠ basename: avatar basename wins (the Priya case)', () => {
    assert.equal(characterFilterName({ name: 'Priya Mehta', avatar: 'Priya.png' }), 'Priya');
});

test('mononym card: basename equals name', () => {
    assert.equal(characterFilterName({ name: 'Aisha', avatar: 'Aisha.png' }), 'Aisha');
});

test('multi-dot avatar: only the extension is stripped', () => {
    assert.equal(characterFilterName({ name: 'X', avatar: 'Dr. Vidya Krishnan.png' }), 'Dr. Vidya Krishnan');
});

test('webp/jpeg extensions stripped too', () => {
    assert.equal(characterFilterName({ name: 'X', avatar: 'Tara.webp' }), 'Tara');
    assert.equal(characterFilterName({ name: 'X', avatar: 'Tara.jpeg' }), 'Tara');
});

test('no avatar: display name is the best-effort fallback', () => {
    assert.equal(characterFilterName({ name: 'Aisha', avatar: '' }), 'Aisha');
    assert.equal(characterFilterName({ name: 'Aisha' }), 'Aisha');
});

test('whitespace avatar falls back; whitespace name → null', () => {
    assert.equal(characterFilterName({ name: 'Aisha', avatar: '   ' }), 'Aisha');
    assert.equal(characterFilterName({ name: '   ', avatar: '' }), null);
});

test('null/undefined/empty target → null, never throws', () => {
    assert.equal(characterFilterName(null), null);
    assert.equal(characterFilterName(undefined), null);
    assert.equal(characterFilterName({}), null);
});

test('extension-only filename does not produce an empty filter', () => {
    // '.png' basename would be '' — must fall back to the name.
    assert.equal(characterFilterName({ name: 'Aisha', avatar: '.png' }), 'Aisha');
});
