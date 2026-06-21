// tests/perCharacterWitness.test.js — PURE helper exercising the real
// filterCompiledSceneForCharacter from witnessScope.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWitnessFilter } from '../perCharacterWitness.js';

// chat fixtures mirror tests/witnessScope.test.js conventions.
const stamped = (aud, name = 'Shilpa') => ({ name, mes: 'x', extra: { channel: { audience: aud } } });
const unstamped = (name = 'Shilpa') => ({ name, mes: 'x' });
const scene = (ids) => ({ metadata: { messageCount: ids.length }, messages: ids.map(id => ({ id, name: 'X', mes: 'm' })) });

const WF_ON = { settings: { witnessFilter: { enabled: true } } };
const WF_OFF = { settings: { witnessFilter: { enabled: false } } };

test('witnessFilter disabled => passthrough, same scene object, skip false', () => {
    const compiled = scene([0, 1, 2]);
    const r = applyWitnessFilter(compiled, { name: 'Aisha' }, WF_OFF, []);
    assert.equal(r.skip, false);
    assert.equal(r.reason, null);
    assert.equal(r.dropped, 0);
    assert.equal(r.compiledScene, compiled); // identical reference — byte-identical passthrough
});

test('charTarget null => passthrough regardless of witnessFilter', () => {
    const compiled = scene([0, 1]);
    const r = applyWitnessFilter(compiled, null, WF_ON, []);
    assert.equal(r.skip, false);
    assert.equal(r.compiledScene, compiled);
});

test('character witnessed some messages => filtered, skip false, dropped counted', () => {
    const chat = [
        stamped(['sachin', 'kavya nair'], 'Kavya Nair'), // 0: Aisha NOT witness
        unstamped('Sachin'),                              // 1: unstamped fail-open -> kept
        stamped(['sachin', 'aisha'], 'Aisha'),            // 2: Aisha witness
    ];
    const compiled = scene([0, 1, 2]);
    const r = applyWitnessFilter(compiled, { name: 'Aisha' }, WF_ON, chat);
    assert.equal(r.skip, false);
    assert.deepEqual(r.compiledScene.messages.map(m => m.id), [1, 2]); // 0 dropped
    assert.equal(r.dropped, 1);
    assert.equal(r.compiledScene.metadata.witnessFiltered, 1);
    assert.equal(r.compiledScene.metadata.messageCount, 2);
});

test('character witnessed none => skip true with reason', () => {
    const chat = [
        stamped(['sachin', 'shilpa'], 'Shilpa'), // 0: Aisha NOT witness
        stamped(['sachin', 'shilpa'], 'Sachin'), // 1: Aisha NOT witness
    ];
    const compiled = scene([0, 1]);
    const r = applyWitnessFilter(compiled, { name: 'Aisha' }, WF_ON, chat);
    assert.equal(r.skip, true);
    assert.equal(r.reason, 'no-witnessed-messages');
    assert.equal(r.dropped, 2);
});

test('all messages witnessed (unstamped fail-open) => no drop, skip false', () => {
    const chat = [unstamped('Shilpa'), unstamped('Sachin')];
    const compiled = scene([0, 1]);
    const r = applyWitnessFilter(compiled, { name: 'Aisha' }, WF_ON, chat);
    assert.equal(r.skip, false);
    assert.equal(r.dropped, 0);
    assert.deepEqual(r.compiledScene.messages.map(m => m.id), [0, 1]);
});
