// tests/plane1.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlane1Memory } from '../plane1.js';

// Build a (chat, compiledScene) pair where compiled msg id == chat index.
function fixture(rows) {
  // rows: [{ name, is_user?, audience?, reality? }]
  const chat = rows.map(r => ({
    name: r.name, is_user: !!r.is_user, mes: r.name + ' line',
    extra: { channel: { ...(r.audience ? { audience: r.audience } : {}), ...(r.reality ? { reality: r.reality } : {}) } },
  }));
  const messages = rows.map((r, i) => ({ id: i, name: r.name, mes: r.name + ' line', is_user: !!r.is_user }));
  return { chat, compiledScene: { metadata: { sceneStart: 0, sceneEnd: rows.length - 1, messageCount: rows.length }, messages } };
}
const ROSTER3 = [
  { name: 'Shilpa', avatar: 'Shilpa.png' },
  { name: 'Aisha', avatar: 'Aisha.png' },
  { name: 'Priya Mehta', avatar: 'Priya.png' },
];

test('U1 solo: one character, gated to that character, nothing dropped', () => {
  const { chat, compiledScene } = fixture([
    { name: 'User', is_user: true, audience: ['user', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.skipped, false);
  assert.deepEqual(r.characterFilter.names, ['Aisha']);
  assert.equal(r.filteredScene.messages.length, 2);
});

test('U2 full group homogeneous: gated to all present, nothing dropped', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.equal(r.filteredScene.messages.length, 2);
});

test('N2 absent char excluded; whisper to a subset is dropped (non-leak)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'] },   // Shilpa absent for this one (sub-cast) -> dropped
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  // present cast = union {user,shilpa,aisha}; keep msgs witnessed by ALL -> only msg 0
  assert.deepEqual(r.filteredScene.messages.map(m => m.id), [0]);
  assert.deepEqual(r.characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.equal(r.characterFilter.names.includes('Priya'), false); // Priya absent -> excluded
});

test('E3/N6 unreal scene dropped before everything', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.filteredScene.messages.map(m => m.id), [0]); // dream msg gone
});

test('all-unreal scene -> skipped (no-op, no throw)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.skipped, true);
});

test('dead-filter fix: gate uses avatar basename not display name', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Priya Mehta', audience: ['user', 'priya mehta'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(r.characterFilter.names, ['Priya']); // NOT 'Priya Mehta'
});

test('fail-open: fully unstamped scene -> no gate, keep all', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha' }, { name: 'Shilpa' },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.characterFilter, null);
  assert.equal(r.filteredScene.messages.length, 2);
});
