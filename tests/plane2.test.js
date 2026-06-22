// tests/plane2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToDeepStorage, parseUpdateNum } from '../plane2.js';

const SAMPLE = `*Epistemic #7 | Scene: kitchen*

## Knows
- Sachin — moved in `+'`(#5)`'+`

## To Deep Storage
- knows | Sachin | lost his IndraNagar flat and hides the debt | resolved | Sachin, flat, debt, IndraNagar
- believes | Aisha | is still single | distant
- garbage line without pipes
- hiding | Aisha | the affair | resolved

## Hiding
- from Aisha — the affair`;

test('parseToDeepStorage extracts pipe rows, skips malformed, parses optional keys field', () => {
  const items = parseToDeepStorage(SAMPLE);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    tag: 'knows', about: 'Sachin',
    fact: 'lost his IndraNagar flat and hides the debt', reason: 'resolved',
    keys: ['Sachin', 'flat', 'debt', 'IndraNagar'],
  });
  assert.equal(items[1].tag, 'believes');
  assert.deepEqual(items[1].keys, []);        // no 5th field -> empty keys
  assert.equal(items[2].tag, 'hiding');       // parse keeps it; eligibility filtered later
});

test('parseToDeepStorage returns [] when no section', () => {
  assert.deepEqual(parseToDeepStorage('## Knows\n- x — y'), []);
});

test('parseUpdateNum reads the header number', () => {
  assert.equal(parseUpdateNum(SAMPLE), 7);
  assert.equal(parseUpdateNum('no header'), null);
});

import { isDeepSaveEligible, deepKeyOf, coldFactTitle, buildColdFactEntry } from '../plane2.js';

const ROSTER = [{ name: 'Shilpa', avatar: 'Shilpa.png' }, { name: 'Aisha', avatar: 'Aisha.png' }];
const SHILPA = { name: 'Shilpa', avatar: 'Shilpa.png' };

test('isDeepSaveEligible: only knows/believes/suspects', () => {
  assert.equal(isDeepSaveEligible('knows'), true);
  assert.equal(isDeepSaveEligible('Believes'), true);
  assert.equal(isDeepSaveEligible('suspects'), true);
  assert.equal(isDeepSaveEligible('hiding'), false);
  assert.equal(isDeepSaveEligible('unaware'), false);
});

test('deepKeyOf: stable across case/whitespace, distinct for different facts', () => {
  const a = deepKeyOf({ fact: 'Lost his  flat   and hides the debt' });
  const b = deepKeyOf({ fact: 'lost his flat and hides the debt' });
  assert.equal(a, b);                                   // normalized -> same dedup key
  assert.notEqual(a, deepKeyOf({ fact: 'lost his flat' }));
});

test('coldFactTitle: [char]: Fact [N]: [summary] format', () => {
  assert.equal(coldFactTitle('Shilpa', 3, 'led Sachin to a café'), 'Shilpa: Fact 3: led Sachin to a café');
});

test('buildColdFactEntry: uses LLM-emitted salient-noun keys when present', () => {
  const item = { tag: 'knows', about: 'Sachin', fact: 'led Sachin to a local café that roasts its own beans', reason: 'distant', keys: ['Sachin', 'café', 'beans'] };
  const e = buildColdFactEntry(item, SHILPA, ROSTER, { updateNum: 7, factNum: 5 });
  assert.deepEqual(e.keys, ['Sachin', 'café', 'beans']);       // not the bare knower name
  assert.match(e.title, /^Shilpa: Fact 5: /);
  assert.equal(e.metadata.STMB_deepNum, 5);
  assert.equal(e.metadata.STMB_deepChar, 'Shilpa');
  assert.equal(typeof e.metadata.STMB_deepKey, 'string');
  assert.deepEqual(e.metadata.STMB_deepKeys, ['Sachin', 'café', 'beans']);
});

test('buildColdFactEntry: gates to knower, marks believes-false, falls back to derived keys', () => {
  const item = { tag: 'believes', about: 'Aisha', fact: 'is still single', reason: 'distant', keys: [] };
  const e = buildColdFactEntry(item, SHILPA, ROSTER, { updateNum: 7, factNum: 1 });
  assert.deepEqual(e.characterFilter, { isExclude: false, names: ['Shilpa'], tags: [] });
  assert.match(e.content, /Shilpa believes \(possibly falsely\) about Aisha: is still single/);
  assert.ok(e.keys.includes('Aisha'));      // fallback derives from `about` + proper nouns
  assert.equal(e.metadata.STMB_deepFalse, true);
  assert.equal(e.metadata.STMB_deepTag, 'believes');
  assert.equal(e.metadata.STMB_deepSince, 7);
});

test('buildColdFactEntry: titleOverride reused (stable title on re-eviction)', () => {
  const item = { tag: 'knows', about: 'Sachin', fact: 'lost his flat', keys: ['flat'] };
  const e = buildColdFactEntry(item, SHILPA, ROSTER, { factNum: 9, titleOverride: 'Shilpa: Fact 2: lost his flat' });
  assert.equal(e.title, 'Shilpa: Fact 2: lost his flat');   // override wins over factNum
});

test('buildColdFactEntry returns null for ineligible tag', () => {
  assert.equal(buildColdFactEntry({ tag: 'hiding', about: 'Aisha', fact: 'x' }, SHILPA, ROSTER), null);
});

test('buildColdFactEntry returns null when the knower cannot be gated (not in roster)', () => {
  const e = buildColdFactEntry({ tag: 'knows', about: 'Sachin', fact: 'x' }, { name: 'Ghost', avatar: 'Ghost.png' }, [{ name: 'Shilpa', avatar: 'Shilpa.png' }]);
  assert.equal(e, null);
});

import { writeDeepFacts } from '../plane2.js';

function spyDeps(existingEntries = {}) {
  const calls = [];
  return {
    calls,
    resolveBookName: () => '🏠 TWW2 - Deep Facts',
    ensureBook: async () => ({ entries: existingEntries }),
    upsertByTitle: async (name, data, title, content, opts) => { calls.push({ name, title, content, opts }); },
  };
}
const TPL_ON = { settings: { deepSave: { enabled: true } } };
const RESULT = `*Epistemic #4 | Scene: x*\n\n## To Deep Storage\n- knows | Sachin | lost his flat | resolved | Sachin, flat\n- hiding | Aisha | the affair | resolved`;

test('writeDeepFacts: writes eligible items, drops ineligible, gates per char, numbers from 1', async () => {
  const d = spyDeps();
  const r = await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa', avatar: 'Shilpa.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }], updateNum: 4 }, d);
  assert.equal(r.written, 1);                 // hiding dropped
  assert.equal(d.calls.length, 1);
  assert.match(d.calls[0].title, /^Shilpa: Fact 1: /);
  assert.deepEqual(d.calls[0].opts.entryOverrides.key, ['Sachin', 'flat']);
  assert.deepEqual(d.calls[0].opts.entryOverrides.characterFilter.names, ['Shilpa']);
  assert.equal(d.calls[0].opts.defaults.vectorized, true);
});

test('writeDeepFacts: per-char sequential continues past existing max number', async () => {
  const existing = {
    '0': { STMB_deep: true, STMB_deepChar: 'Shilpa', STMB_deepNum: 7, STMB_deepKey: 'deadbeef', comment: 'Shilpa: Fact 7: old' },
  };
  const d = spyDeps(existing);
  const r = await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa', avatar: 'Shilpa.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }], updateNum: 4 }, d);
  assert.equal(r.written, 1);
  assert.match(d.calls[0].title, /^Shilpa: Fact 8: /);     // continues from max(7)+1
});

test('writeDeepFacts: idempotent — re-evicting same fact reuses its number/title, no renumber', async () => {
  const factKey = deepKeyOf({ fact: 'lost his flat' });
  const existing = {
    '0': { STMB_deep: true, STMB_deepChar: 'Shilpa', STMB_deepNum: 2, STMB_deepKey: factKey, comment: 'Shilpa: Fact 2: lost his flat' },
  };
  const d = spyDeps(existing);
  const r = await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa', avatar: 'Shilpa.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }], updateNum: 9 }, d);
  assert.equal(r.written, 1);
  assert.equal(d.calls[0].title, 'Shilpa: Fact 2: lost his flat');   // same number + title, not Fact 8
});

test('writeDeepFacts: skips when disabled / no char / no items / no gate', async () => {
  assert.deepEqual(await writeDeepFacts({ tpl: { settings: {} }, charTarget: { name: 'Shilpa' }, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'disabled' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: null, resultText: RESULT }, spyDeps()), { written: 0, skipped: 'no-char' });
  assert.deepEqual(await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Shilpa' }, resultText: 'no section' }, spyDeps()), { written: 0 });
  // knower not in roster -> ungateable -> nothing written
  assert.deepEqual((await writeDeepFacts({ tpl: TPL_ON, charTarget: { name: 'Ghost', avatar: 'Ghost.png' }, resultText: RESULT, rosterRows: [{ name: 'Shilpa', avatar: 'Shilpa.png' }] }, spyDeps())).written, 0);
});
