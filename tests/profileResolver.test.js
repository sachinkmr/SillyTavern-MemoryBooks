import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProfileSafe } from '../profileResolver.js';

const builtin = { name: 'Current SillyTavern Settings', isBuiltinCurrentST: true };
const custom = { name: 'My GPT Profile' };

test('getProfileSafe returns the profile at an in-range index', () => {
    const settings = { profiles: [builtin, custom] };
    assert.equal(getProfileSafe(settings, 0), builtin);
    assert.equal(getProfileSafe(settings, 1), custom);
});

test('getProfileSafe falls back to the builtin Current ST profile on a stale index', () => {
    // The user-reported crash: 1 profile, stored index points past the end.
    const settings = { profiles: [builtin] };
    assert.equal(getProfileSafe(settings, 1), builtin);
    // Builtin not at index 0 is still preferred over profiles[0].
    const reordered = { profiles: [custom, builtin] };
    assert.equal(getProfileSafe(reordered, 99), builtin);
});

test('getProfileSafe falls back to profiles[0] when no builtin profile exists', () => {
    const settings = { profiles: [custom] };
    assert.equal(getProfileSafe(settings, 5), custom);
});

test('getProfileSafe tolerates undefined/NaN/negative indices (missing defaultProfile key)', () => {
    const settings = { profiles: [builtin, custom] };
    assert.equal(getProfileSafe(settings, undefined), builtin);
    assert.equal(getProfileSafe(settings, NaN), builtin);
    assert.equal(getProfileSafe(settings, -1), builtin);
    assert.equal(getProfileSafe(settings, null), builtin);
});

test('getProfileSafe returns null only when there are no profiles at all', () => {
    assert.equal(getProfileSafe({ profiles: [] }, 0), null);
    assert.equal(getProfileSafe({}, 0), null);
    assert.equal(getProfileSafe(null, 0), null);
    assert.equal(getProfileSafe(undefined, undefined), null);
});

test('getProfileSafe skips sparse/null slots when hunting for the builtin', () => {
    const settings = { profiles: [null, builtin] };
    assert.equal(getProfileSafe(settings, 7), builtin);
});
