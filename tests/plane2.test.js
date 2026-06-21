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
