import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBounded, resolveParallelLimit } from '../concurrency.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('runBounded preserves input order in results despite out-of-order completion', async () => {
    // Item 0 finishes LAST, item 2 finishes FIRST — results must still be in input order.
    const delays = [30, 15, 1];
    const results = await runBounded([0, 1, 2], 3, async (item) => {
        await sleep(delays[item]);
        return `done-${item}`;
    });
    assert.deepEqual(results, [
        { ok: true, value: 'done-0' },
        { ok: true, value: 'done-1' },
        { ok: true, value: 'done-2' },
    ]);
});

test('runBounded passes (item, index) to fn', async () => {
    const seen = [];
    await runBounded(['a', 'b'], 2, async (item, index) => {
        seen.push([item, index]);
    });
    seen.sort((x, y) => x[1] - y[1]);
    assert.deepEqual(seen, [['a', 0], ['b', 1]]);
});

test('runBounded never exceeds the limit and actually reaches it', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await runBounded([0, 1, 2, 3, 4, 5], 2, async (item) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(5);
        inFlight--;
        return item;
    });
    assert.equal(maxInFlight, 2, `expected max 2 in flight, saw ${maxInFlight}`);
    assert.equal(results.length, 6);
    assert.ok(results.every(r => r.ok));
});

test('runBounded isolates errors: a rejection becomes { ok:false, error } in its slot', async () => {
    const boom = new Error('llm exploded');
    const results = await runBounded([0, 1, 2], 2, async (item) => {
        if (item === 1) throw boom;
        return `ok-${item}`;
    });
    assert.deepEqual(results[0], { ok: true, value: 'ok-0' });
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error, boom);
    assert.deepEqual(results[2], { ok: true, value: 'ok-2' });
});

test('runBounded with limit=1 degenerates to strictly sequential execution', async () => {
    const events = [];
    await runBounded([0, 1, 2], 1, async (item) => {
        events.push(`start-${item}`);
        await sleep(1);
        events.push(`end-${item}`);
    });
    assert.deepEqual(events, ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']);
});

test('runBounded handles empty items and clamps a nonsensical limit to at least 1', async () => {
    assert.deepEqual(await runBounded([], 3, async () => 'x'), []);
    const results = await runBounded([7], 0, async (item) => item * 2);
    assert.deepEqual(results, [{ ok: true, value: 14 }]);
});

test('resolveParallelLimit: absent/disabled -> 1 (sequential)', () => {
    assert.equal(resolveParallelLimit(undefined), 1);
    assert.equal(resolveParallelLimit(null), 1);
    assert.equal(resolveParallelLimit({}), 1);
    assert.equal(resolveParallelLimit({ enabled: false, limit: 4 }), 1);
});

test('resolveParallelLimit: enabled clamps limit into [2..4], default 2', () => {
    assert.equal(resolveParallelLimit({ enabled: true }), 2);
    assert.equal(resolveParallelLimit({ enabled: true, limit: 1 }), 2);
    assert.equal(resolveParallelLimit({ enabled: true, limit: 3 }), 3);
    assert.equal(resolveParallelLimit({ enabled: true, limit: 99 }), 4);
    assert.equal(resolveParallelLimit({ enabled: true, limit: 'nonsense' }), 2);
});
