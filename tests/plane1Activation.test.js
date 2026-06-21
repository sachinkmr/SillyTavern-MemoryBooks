// tests/plane1Activation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeWorldBookActivation,
    isMemoryBookName,
    MEMORY_BOOK_SUFFIX,
} from '../plane1Activation.js';

const W = 'TWW2 - Memories';
const W2 = 'Riverside - Memories';
const USERBOOK = 'My Chat Lore';        // a non-memory book (user's own)
const CHARBOOK = 'Aisha - Core';        // a non-memory book

test('isMemoryBookName: only names ending in the memory suffix qualify', () => {
    assert.equal(isMemoryBookName(W), true);
    assert.equal(isMemoryBookName('X' + MEMORY_BOOK_SUFFIX), true);
    assert.equal(isMemoryBookName(USERBOOK), false);
    assert.equal(isMemoryBookName(CHARBOOK), false);
    assert.equal(isMemoryBookName(''), false);
    assert.equal(isMemoryBookName(null), false);
    assert.equal(isMemoryBookName(undefined), false);
    assert.equal(isMemoryBookName(123), false);
});

test('FLAG-OFF: no-op regardless of resolved book or active set', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [W2],
        isTwoPlane: false,
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [] });
});

test('FLAG-OFF: missing isTwoPlane (undefined) is treated as off -> no-op', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [],
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [] });
});

test('Enter world W with nothing active: activate "W - Memories"', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [W], toDeactivate: [] });
});

test('Idempotent: W already the sole active memory book -> no-op', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [W],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [] });
});

test('Per-world switch: entering W deactivates the OTHER world memory book', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [W], toDeactivate: [W2] });
});

test('Per-world switch: W active alongside a stale other -> add nothing, drop the stale', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [W, W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [W2] });
});

test('No world resolves (null) with flag ON: deactivate all memory books, activate none', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: null,
        currentlyActiveMemoryBooks: [W, W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r.toActivate, []);
    assert.deepEqual(r.toDeactivate.sort(), [W2, W].sort());
});

test('No world resolves (null) with nothing active: total no-op', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: null,
        currentlyActiveMemoryBooks: [],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [] });
});

test('Accepts a bare string for resolvedWorldBook', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: W,
        currentlyActiveMemoryBooks: [],
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [W], toDeactivate: [] });
});

test('Resolved book that is NOT a memory book is ignored (treated as null)', () => {
    // Defensive: a malformed resolve must never push a non-memory name.
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: USERBOOK },
        currentlyActiveMemoryBooks: [W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r.toActivate, []);
    // and it still clears the stale memory book (per-world hygiene)
    assert.deepEqual(r.toDeactivate, [W2]);
});

test('Non-memory books never appear in the delta (caller pre-filters, helper double-guards)', () => {
    // Even if a caller wrongly passes user/char books in the active list, the
    // helper filters them out so they can never be scheduled for deactivation.
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [USERBOOK, CHARBOOK, W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r.toActivate, [W]);
    assert.deepEqual(r.toDeactivate, [W2]); // USERBOOK/CHARBOOK NOT present
});

test('Dedups a duplicated active entry', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: { name: W },
        currentlyActiveMemoryBooks: [W2, W2],
        isTwoPlane: true,
    });
    assert.deepEqual(r.toActivate, [W]);
    assert.deepEqual(r.toDeactivate, [W2]);
});

test('Garbage inputs do not throw and yield a no-op-ish result', () => {
    const r = computeWorldBookActivation({
        resolvedWorldBook: 42,
        currentlyActiveMemoryBooks: null,
        isTwoPlane: true,
    });
    assert.deepEqual(r, { toActivate: [], toDeactivate: [] });
});
