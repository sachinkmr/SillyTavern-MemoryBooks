import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    audienceOf, messageWitnessedBy, isPresentInWindow, filterCompiledSceneForCharacter,
    realityOf, isUnreal, dropUnrealMessages,
} from '../witnessScope.js';

const stamped = (aud, name = 'Shilpa', extra = {}) => ({
    name, mes: 'x', extra: { channel: { audience: aud } }, ...extra,
});
const unstamped = (name = 'Shilpa', extra = {}) => ({ name, mes: 'x', ...extra });

test('audienceOf returns lowercase array for stamped, null for unstamped', () => {
    assert.deepEqual(audienceOf(stamped(['Sachin', 'KAVYA NAIR'])), ['sachin', 'kavya nair']);
    assert.equal(audienceOf(unstamped()), null);
    assert.equal(audienceOf(null), null);
});

test('messageWitnessedBy: in-audience true, out false, unstamped fail-open true', () => {
    assert.equal(messageWitnessedBy(stamped(['sachin', 'kavya nair']), 'Kavya Nair'), true);
    assert.equal(messageWitnessedBy(stamped(['sachin', 'kavya nair']), 'Aisha'), false);
    assert.equal(messageWitnessedBy(unstamped(), 'Aisha'), true);
});

test('isPresentInWindow: via audience stamp', () => {
    const chat = [stamped(['sachin', 'aisha'], 'Aisha')];
    assert.equal(isPresentInWindow('Aisha', chat, 0, 0), true);
    assert.equal(isPresentInWindow('Meera', chat, 0, 0), false);
});

test('isPresentInWindow: via authored bubble (remote-texting fallback, no stamp)', () => {
    const chat = [unstamped('Kavya Nair')];
    assert.equal(isPresentInWindow('kavya nair', chat, 0, 0), true);
});

test('isPresentInWindow: is_system skipped; user bubbles do not qualify a char; window bounds respected', () => {
    const chat = [
        stamped(['sachin', 'meera'], 'Meera', { is_system: true }), // hidden
        unstamped('Sachin', { is_user: true }),
        stamped(['sachin', 'shilpa'], 'Shilpa'),
    ];
    assert.equal(isPresentInWindow('Meera', chat, 0, 2), false);   // only hidden msg
    assert.equal(isPresentInWindow('Sachin', chat, 1, 1), false);  // user bubble, is_user
    assert.equal(isPresentInWindow('Shilpa', chat, 0, 1), false);  // outside window
    assert.equal(isPresentInWindow('Shilpa', chat, 0, 2), true);
});

test('filterCompiledSceneForCharacter joins by id, fail-open, updates metadata', () => {
    const chat = [
        stamped(['sachin', 'kavya nair'], 'Kavya Nair'), // 0: private — Aisha NOT witness
        unstamped('Sachin', { is_user: true }),          // 1: untagged — fail-open, kept
        stamped(['sachin', 'aisha'], 'Aisha'),           // 2: Aisha witness
    ];
    const compiled = {
        metadata: { messageCount: 3 },
        messages: [
            { id: 0, name: 'Kavya Nair', mes: 'secret' },
            { id: 1, name: 'Sachin', mes: 'hello' },
            { id: 2, name: 'Aisha', mes: 'hey' },
        ],
    };
    const out = filterCompiledSceneForCharacter(compiled, chat, 'Aisha');
    assert.deepEqual(out.messages.map(m => m.id), [1, 2]);
    assert.equal(out.metadata.messageCount, 2);
    assert.equal(out.metadata.witnessFiltered, 1);
    // input untouched
    assert.equal(compiled.messages.length, 3);
});

test('realityOf returns the lowercased reality tag or null', () => {
    assert.equal(realityOf({ extra: { channel: { reality: 'Dream' } } }), 'dream');
    assert.equal(realityOf({ extra: { channel: {} } }), null);
    assert.equal(realityOf({}), null);
});

test('isUnreal is true for dream/flashback/story, false otherwise', () => {
    assert.equal(isUnreal({ extra: { channel: { reality: 'dream' } } }), true);
    assert.equal(isUnreal({ extra: { channel: { reality: 'flashback' } } }), true);
    assert.equal(isUnreal({ extra: { channel: { reality: 'story' } } }), true);
    assert.equal(isUnreal({ extra: { channel: { reality: 'real' } } }), false);
    assert.equal(isUnreal({ extra: {} }), false);
});

test('dropUnrealMessages removes only unreal-tagged messages', () => {
    const msgs = [
        { mes: 'a' },                                                   // real (unstamped)
        { mes: 'b', extra: { channel: { reality: 'dream' } } },         // unreal
        { mes: 'c', extra: { channel: { audience: ['aisha'] } } },      // real
    ];
    assert.deepEqual(dropUnrealMessages(msgs).map(m => m.mes), ['a', 'c']);
    assert.deepEqual(dropUnrealMessages(null), []);
});
