// tests/worldScopeBridge.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWorld, readActiveWorldName } from '../worldScopeBridge.js';

test('pickWorld: returns the first non-empty trimmed candidate (WorldScope wins)', () => {
    assert.equal(pickWorld('🏠 TWW2', 'TAM2'), '🏠 TWW2');
    assert.equal(pickWorld('  🏠 TWW2  ', 'TAM2'), '🏠 TWW2'); // trimmed
});

test('pickWorld: skips empty / whitespace / null / undefined, falls through', () => {
    assert.equal(pickWorld('', '   ', null, undefined, 'TWW2'), 'TWW2');
    assert.equal(pickWorld(null, 0, false, {}, 'World'), 'World'); // non-strings skipped
});

test('pickWorld: returns "" when no candidate qualifies (caller then guards/falls back)', () => {
    assert.equal(pickWorld(), '');
    assert.equal(pickWorld('', '   ', null, undefined), '');
});

test('readActiveWorldName: "" under node (no window) — never throws', () => {
    assert.equal(readActiveWorldName(), '');
});

test('readActiveWorldName: reads window.WorldScope.activeWorld when present', () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prev = globalThis.window;
    try {
        globalThis.window = { WorldScope: { activeWorld: '🏠 TWW2' } };
        assert.equal(readActiveWorldName(), '🏠 TWW2');
        globalThis.window = { WorldScope: {} };           // present but no activeWorld
        assert.equal(readActiveWorldName(), '');
        globalThis.window = {};                            // no WorldScope
        assert.equal(readActiveWorldName(), '');
    } finally {
        if (had) globalThis.window = prev; else delete globalThis.window;
    }
});
