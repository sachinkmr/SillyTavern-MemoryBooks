// tests/plane1.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlane1Memory, computePlane1Segments, resolveMemoryLorebook } from '../plane1.js';

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
  // user is in the input-filter cast (returned audience) but NOT in the gate names
  assert.deepEqual(r.audience.sort(), ['aisha', 'user']);
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

test('no-cast-witnessed: disjoint audiences -> skipped (conservative; 1b will segment)', () => {
  // Shilpa present only for msg0, Aisha only for msg1 -> union cast {user,shilpa,aisha},
  // no single message witnessed by all three -> input-filter empties -> skipped.
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },
    { name: 'Aisha', audience: ['user', 'aisha'] },
  ]);
  const r = computePlane1Memory(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no-cast-witnessed');
});

const segIds = s => s.filteredScene.messages.map(m => m.id);

test('U2 homogeneous: full-group scene is exactly ONE segment (no spurious split)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
});

test('U4 enter: Aisha joins mid-scene → 2 segments; Aisha never fed pre-entry msg', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // seg0 — before Aisha
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // seg1 — Aisha present
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].characterFilter.names, ['Shilpa']);
  assert.deepEqual(segIds(segs[0]), [0]);                          // Aisha NOT in seg0
  assert.deepEqual(segs[1].characterFilter.names.sort(), ['Aisha', 'Shilpa']);
  assert.deepEqual(segIds(segs[1]), [1]);
});

test('U5 exit-return: Aisha leaves then returns → 3 segments; Aisha gets seg0+seg2 only', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa', 'aisha'] },    // seg0
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // seg1 — Aisha gone
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // seg2 — Aisha back
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);
  assert.deepEqual(segIds(segs[1]), [1]);
  assert.deepEqual(segs[1].characterFilter.names, ['Shilpa']);    // Aisha excluded from seg1
  // Aisha's memory = union of seg0+seg2 (segments where she is in audience), never seg1.
  const aishaSegs = segs.filter(s => s.audience.includes('aisha'));
  assert.deepEqual(aishaSegs.map(s => segIds(s)).flat(), [0, 2]);
});

test('E9 grow/shrink: each segment is one audience run; disjoint partition', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // run A
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // run B
    { name: 'Aisha', audience: ['user', 'shilpa', 'aisha'] },     // run B (same set → same seg)
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // run C
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);
  assert.deepEqual(segIds(segs[0]), [0]);
  assert.deepEqual(segIds(segs[1]), [1, 2]);                       // contiguous same-set run merges
  assert.deepEqual(segIds(segs[2]), [3]);
  const all = segs.flatMap(segIds).sort((a, b) => a - b);
  assert.deepEqual(all, [0, 1, 2, 3]);                            // disjoint, complete
});

test('single-perceiver drop: a [aisha]-only run is dropped; mixed scene keeps the rest', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['aisha'] },                       // single perceiver → drop
    { name: 'Aisha', audience: ['user', 'aisha'] },               // 2 perceivers → keep
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segIds(segs[0]), [1]);
  assert.deepEqual(segs[0].characterFilter.names, ['Aisha']);
});

test('all single-perceiver / all-unreal → empty array', () => {
  const a = fixture([{ name: 'Aisha', audience: ['aisha'] }]);
  assert.deepEqual(computePlane1Segments(a.compiledScene, a.chat, ROSTER3, { userToken: 'user' }), []);
  const b = fixture([{ name: 'Aisha', audience: ['user', 'aisha'], reality: 'dream' }]);
  assert.deepEqual(computePlane1Segments(b.compiledScene, b.chat, ROSTER3, { userToken: 'user' }), []);
});

test('unstamped extends current run (fail-open, inherits gate)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Aisha', audience: ['user', 'aisha'] },               // stamped run
    { name: 'Aisha' },                                            // unstamped → extends run, no new seg
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
  assert.deepEqual(segs[0].characterFilter.names, ['Aisha']);
});

test('unstamped between two different-set runs extends the PRIOR run (no new segment)', () => {
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa', audience: ['user', 'shilpa'] },             // run 0
    { name: 'Shilpa' },                                           // unstamped → absorbed into run 0
    { name: 'Aisha', audience: ['user', 'aisha'] },              // run 1 (different set)
  ]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 2);
  assert.deepEqual(segIds(segs[0]), [0, 1]);                      // unstamped joins prior, not its own seg
  assert.deepEqual(segs[0].characterFilter.names, ['Shilpa']);
  assert.deepEqual(segIds(segs[1]), [2]);
  assert.deepEqual(segs[1].characterFilter.names, ['Aisha']);
});

test('fully unstamped scene → one fail-open (ungated) segment', () => {
  const { chat, compiledScene } = fixture([{ name: 'Aisha' }, { name: 'Shilpa' }]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 1);
  assert.equal(segs[0].characterFilter, null);
  assert.deepEqual(segIds(segs[0]), [0, 1]);
});

test('dead-filter: per-segment gate uses avatar basenames', () => {
  const { chat, compiledScene } = fixture([{ name: 'Priya Mehta', audience: ['user', 'priya mehta'] }]);
  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.deepEqual(segs[0].characterFilter.names, ['Priya']);     // NOT 'Priya Mehta'
});

// --- Phase-2 follow-up: whisper-merge tests ---

test('WHISPER-MERGE: {A,Sh} whisper(present_cast covers both) {A,Sh} → ONE merged {A,Sh} segment + whisper segment', () => {
  // Build fixture: msg0={A,Sh}, msg1={Sh} whisper (Aisha stayed present), msg2={A,Sh}
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa',  audience: ['user', 'shilpa', 'aisha'] },           // msg 0
    { name: 'Shilpa',  audience: ['user', 'shilpa'] },                    // msg 1 — directed/whisper
    { name: 'Aisha',   audience: ['user', 'shilpa', 'aisha'] },           // msg 2
  ]);
  // Stamp present_cast on the whisper: Aisha stayed present in the room
  chat[1].extra.channel.present_cast = ['user', 'shilpa', 'aisha'];

  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });

  // Expect exactly 2 segments: the merged {A,Sh} segment + the {Sh} whisper segment
  assert.equal(segs.length, 2);

  // Find the merged {A,Sh} segment — audience includes both
  const aiShaSeg = segs.find(s => s.audience.includes('aisha') && s.audience.includes('shilpa'));
  assert.ok(aiShaSeg, 'merged {A,Sh} segment must exist');
  // Its messages must be [0,2] (skipping whisper at 1)
  assert.deepEqual(segIds(aiShaSeg), [0, 2]);
  assert.deepEqual(aiShaSeg.characterFilter.names.sort(), ['Aisha', 'Shilpa']);

  // The {Sh}-only whisper segment
  const shSeg = segs.find(s => !s.audience.includes('aisha') && s.audience.includes('shilpa'));
  assert.ok(shSeg, '{Sh} whisper segment must exist');
  assert.deepEqual(segIds(shSeg), [1]);
});

test('EXIT-NO-MERGE: {A,Sh} genuine-exit {Sh no present_cast} {A,Sh} → 3 segments (no merge)', () => {
  // msg1 has no present_cast → treated as a genuine exit; {A,Sh} segments must NOT merge
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa',  audience: ['user', 'shilpa', 'aisha'] },           // msg 0
    { name: 'Shilpa',  audience: ['user', 'shilpa'] },                    // msg 1 — no present_cast
    { name: 'Aisha',   audience: ['user', 'shilpa', 'aisha'] },           // msg 2
  ]);
  // No mutation of chat[1] — no present_cast → genuine exit

  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);
  assert.deepEqual(segIds(segs[0]), [0]);
  assert.deepEqual(segIds(segs[1]), [1]);
  assert.deepEqual(segIds(segs[2]), [2]);
});

test('WHISPER-MERGE: present_cast excludes a member → no merge (member was absent)', () => {
  // msg1 present_cast does NOT include aisha → she genuinely left → no merge
  const { chat, compiledScene } = fixture([
    { name: 'Shilpa',  audience: ['user', 'shilpa', 'aisha'] },
    { name: 'Shilpa',  audience: ['user', 'shilpa'] },
    { name: 'Aisha',   audience: ['user', 'shilpa', 'aisha'] },
  ]);
  chat[1].extra.channel.present_cast = ['user', 'shilpa'];  // Aisha NOT listed → exit

  const segs = computePlane1Segments(compiledScene, chat, ROSTER3, { userToken: 'user' });
  assert.equal(segs.length, 3);   // no merge: 3 separate segments
});

test('resolveMemoryLorebook: flag OFF → legacy validator only (world never resolved)', async () => {
  let worldCalled = false, legacyCalled = false;
  const r = await resolveMemoryLorebook({
    twoPlane: false,
    resolveWorld: async () => { worldCalled = true; return { valid: true, name: 'W - Memories' }; },
    legacyValidate: async () => { legacyCalled = true; return { valid: true, name: 'ChatBook' }; },
  });
  assert.equal(worldCalled, false);
  assert.equal(legacyCalled, true);
  assert.equal(r.name, 'ChatBook');
});

test('resolveMemoryLorebook: two-plane + world resolves → world book, legacy NOT called (no popup)', async () => {
  let legacyCalled = false;
  const r = await resolveMemoryLorebook({
    twoPlane: true,
    resolveWorld: async () => ({ valid: true, name: 'W - Memories' }),
    legacyValidate: async () => { legacyCalled = true; return { valid: false }; },
  });
  assert.equal(r.name, 'W - Memories');
  assert.equal(legacyCalled, false);   // the chat-bound gate/popup never fires
});

test('resolveMemoryLorebook: two-plane + no world → falls back to legacy validator', async () => {
  let legacyCalled = false;
  const r = await resolveMemoryLorebook({
    twoPlane: true,
    resolveWorld: async () => null,
    legacyValidate: async () => { legacyCalled = true; return { valid: true, name: 'ChatBook' }; },
  });
  assert.equal(legacyCalled, true);
  assert.equal(r.name, 'ChatBook');
});
