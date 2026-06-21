// tests/plane2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToDeepStorage, parseUpdateNum } from '../plane2.js';

const SAMPLE = `*Epistemic #7 | Scene: kitchen*

## Knows
- Sachin — moved in `+'`(#5)`'+`

## To Deep Storage
- knows | Sachin | lost his IndraNagar flat and hides the debt | resolved
- believes | Aisha | is still single | distant
- garbage line without pipes
- hiding | Aisha | the affair | resolved

## Hiding
- from Aisha — the affair`;

test('parseToDeepStorage extracts pipe rows, skips malformed', () => {
  const items = parseToDeepStorage(SAMPLE);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { tag: 'knows', about: 'Sachin', fact: 'lost his IndraNagar flat and hides the debt', reason: 'resolved' });
  assert.equal(items[1].tag, 'believes');
  assert.equal(items[2].tag, 'hiding'); // parse keeps it; eligibility filtered later
});

test('parseToDeepStorage returns [] when no section', () => {
  assert.deepEqual(parseToDeepStorage('## Knows\n- x — y'), []);
});

test('parseUpdateNum reads the header number', () => {
  assert.equal(parseUpdateNum(SAMPLE), 7);
  assert.equal(parseUpdateNum('no header'), null);
});

import { isDeepSaveEligible, coldFactTitle, buildColdFactEntry } from '../plane2.js';

const ROSTER = [{ name: 'Shilpa', avatar: 'Shilpa.png' }, { name: 'Aisha', avatar: 'Aisha.png' }];
const SHILPA = { name: 'Shilpa', avatar: 'Shilpa.png' };

test('isDeepSaveEligible: only knows/believes/suspects', () => {
  assert.equal(isDeepSaveEligible('knows'), true);
  assert.equal(isDeepSaveEligible('Believes'), true);
  assert.equal(isDeepSaveEligible('suspects'), true);
  assert.equal(isDeepSaveEligible('hiding'), false);
  assert.equal(isDeepSaveEligible('unaware'), false);
});

test('buildColdFactEntry gates to the knower, marks believes-false', () => {
  const item = { tag: 'believes', about: 'Aisha', fact: 'is still single', reason: 'distant' };
  const e = buildColdFactEntry(item, SHILPA, ROSTER, { updateNum: 7 });
  assert.deepEqual(e.characterFilter, { isExclude: false, names: ['Shilpa'], tags: [] });
  assert.match(e.content, /Shilpa believes \(possibly falsely\) about Aisha: is still single/);
  assert.deepEqual(e.keys, ['Aisha']);
  assert.equal(e.metadata.STMB_deepFalse, true);
  assert.equal(e.metadata.STMB_deepTag, 'believes');
  assert.equal(e.metadata.STMB_deepSince, 7);
});

test('buildColdFactEntry returns null for ineligible tag', () => {
  assert.equal(buildColdFactEntry({ tag: 'hiding', about: 'Aisha', fact: 'x' }, SHILPA, ROSTER), null);
});

test('coldFactTitle is stable + dedup-bearing (same fact -> same title)', () => {
  const it = { tag: 'knows', about: 'Sachin', fact: 'lost his flat and hides the debt' };
  assert.equal(coldFactTitle('Shilpa', it), coldFactTitle('Shilpa', it));
  assert.match(coldFactTitle('Shilpa', it), /^\[Deep\]\[Shilpa\] knows:Sachin —/);
});

test('buildColdFactEntry returns null when the knower cannot be gated (not in roster)', () => {
  const e = buildColdFactEntry({ tag: 'knows', about: 'Sachin', fact: 'x' }, { name: 'Ghost', avatar: 'Ghost.png' }, [{ name: 'Shilpa', avatar: 'Shilpa.png' }]);
  assert.equal(e, null);
});

import { writeDeepFacts } from '../plane2.js';

function spyDeps() {
  const calls = [];
  return {
    calls,
    resolveBookName: () => '🏠 TWW2 - Deep Facts',
    ensureBook: async () => ({ entries: {} }),
    upsertByTitle: async (name, data, title, content, opts) => { calls.push({ name, title, content, opts }); },
  };
}
const TPL_ON = { settings: { deepSave: { enabled: true } } };
const RESULT = `*Epistemic #4 | Scene: x*\n\n## To Deep Storage\n- knows | Sachin | lost his flat | resolved\n- hiding | Aisha | the affair | resolved`;

test('writeDeepFacts: writes eligible items, drops ineligible, gates per char', async () => {
  const d = spyDeps();
  const r = await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa', avatar: 'Shilpa.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }], updateNum: 4 }, d);
  assert.equal(r.written, 1);                 // hiding dropped
  assert.equal(d.calls.length, 1);
  assert.deepEqual(d.calls[0].opts.entryOverrides.characterFilter.names, ['Shilpa']);
  assert.equal(d.calls[0].opts.defaults.vectorized, true);
});

test('writeDeepFacts: skips when disabled / no char / no items', async () => {
  assert.deepEqual(await writeDeepFacts({ tpl: { settings: {} }, charTarget: { name: 'Shilpa' }, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'disabled' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: null, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'no-char' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa' }, resultText: 'no section' }, spyDeps()), { written: 0 });
});
