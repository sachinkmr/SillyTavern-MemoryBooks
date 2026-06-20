// tests/memoryEntry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalName, buildCharacterFilter } from '../memoryEntry.js';

const ROSTER = ['Sachin', 'Shilpa', 'Aisha', 'Kavya Nair'];

test('canonicalName resolves exact (case-insensitive) and first-token names', () => {
    assert.equal(canonicalName('aisha', ROSTER), 'Aisha');
    assert.equal(canonicalName('SHILPA', ROSTER), 'Shilpa');
    assert.equal(canonicalName('kavya', ROSTER), 'Kavya Nair');   // first-token
    assert.equal(canonicalName('Kavya Nair', ROSTER), 'Kavya Nair');
    assert.equal(canonicalName('ghost', ROSTER), null);            // unresolved
    assert.equal(canonicalName('', ROSTER), null);
});

test('buildCharacterFilter: empty/missing audience is fail-open (null)', () => {
    assert.equal(buildCharacterFilter([], ROSTER), null);
    assert.equal(buildCharacterFilter(null, ROSTER), null);
});

test('buildCharacterFilter: resolved audience → scoped names', () => {
    assert.deepEqual(buildCharacterFilter(['sachin', 'shilpa'], ROSTER), {
        isExclude: false, names: ['Sachin', 'Shilpa'], tags: [], unresolved: [],
    });
});

test('N9: a non-empty audience NEVER fails open; unresolved names match nobody', () => {
    // 'ghost' cannot resolve → must NOT yield null (which would be fail-open = leak).
    const f = buildCharacterFilter(['ghost'], ROSTER);
    assert.notEqual(f, null, 'must not fail open on a non-empty private audience');
    assert.deepEqual(f, { isExclude: false, names: [], tags: [], unresolved: ['ghost'] });
});

test('buildCharacterFilter dedups and partially resolves', () => {
    assert.deepEqual(buildCharacterFilter(['aisha', 'aisha', 'ghost'], ROSTER), {
        isExclude: false, names: ['Aisha'], tags: [], unresolved: ['ghost'],
    });
});

test('canonicalName: ambiguous first token resolves to nobody (fail-closed)', () => {
    const roster = ['Kavya Nair', 'Kavya Reddy'];
    assert.equal(canonicalName('kavya', roster), null);              // ambiguous → null
    assert.equal(canonicalName('Kavya Nair', roster), 'Kavya Nair'); // exact still wins
});

test('buildCharacterFilter: ambiguous first token → matches nobody, not the wrong target', () => {
    const roster = ['Kavya Nair', 'Kavya Reddy'];
    assert.deepEqual(buildCharacterFilter(['kavya'], roster), {
        isExclude: false, names: [], tags: [], unresolved: ['kavya'],
    });
});
