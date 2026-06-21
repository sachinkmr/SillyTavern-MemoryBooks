// tests/rollupScope.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audienceNamesOf, partitionByAudience, audienceUnion,
  planRollupFragments, witnessPromptFragment, SHARP_MAX_TIER,
} from '../rollupScope.js';

const E = (names, id) => ({ uid: id, characterFilter: names === null ? null : { isExclude: false, names, tags: [] } });

test('audienceNamesOf: null filter => null (everyone); names normalized+sorted', () => {
  assert.equal(audienceNamesOf(E(null, 1)), null);
  assert.deepEqual(audienceNamesOf(E(['shilpa', 'aisha', 'aisha'], 1)), ['aisha', 'shilpa']);
});

test('U9 arc rollup, uniform audience => one fragment gated to that audience', () => {
  const segs = [E(['aisha', 'shilpa'], 1), E(['aisha', 'shilpa'], 2), E(['aisha', 'shilpa'], 3)];
  const frags = planRollupFragments(segs, 1);
  assert.equal(frags.length, 1);
  assert.deepEqual(frags[0].characterFilter.names, ['aisha', 'shilpa']);
  assert.equal(frags[0].soft, false);
  assert.deepEqual(frags[0].entries.map(e => e.uid), [1, 2, 3]);
});

test('U10/N5 arc rollup, mixed audience => 2 fragments, non-contiguous grouping, no leak', () => {
  const seg1 = E(['aisha', 'shilpa'], 1), seg2 = E(['shilpa'], 2), seg3 = E(['aisha', 'shilpa'], 3);
  const frags = planRollupFragments([seg1, seg2, seg3], 1);
  assert.equal(frags.length, 2);
  const fx = frags.find(f => f.characterFilter.names.length === 2);
  const fy = frags.find(f => f.characterFilter.names.length === 1);
  assert.deepEqual(fx.entries.map(e => e.uid), [1, 3]); // non-contiguous merge
  assert.deepEqual(fy.entries.map(e => e.uid), [2]);
  assert.deepEqual(fy.characterFilter.names, ['shilpa']);
  // N5: the {aisha,shilpa} fragment never contains seg2 content
  assert.ok(!fx.entries.some(e => e.uid === 2));
});

test('shell as leaf: a singleton-audience group is KEPT, not dropped', () => {
  const frags = planRollupFragments([E(['aisha'], 1), E(['aisha', 'shilpa'], 2)], 1);
  assert.equal(frags.length, 2);
  assert.ok(frags.some(f => f.characterFilter.names.length === 1 && f.entries[0].uid === 1));
});

test('E8 book tier (>chapter) => single UNION fragment, soft=true', () => {
  const frags = planRollupFragments([E(['aisha', 'shilpa'], 1), E(['shilpa'], 2)], 3);
  assert.equal(frags.length, 1);
  assert.deepEqual(frags[0].characterFilter.names, ['aisha', 'shilpa']);
  assert.equal(frags[0].soft, true);
  assert.deepEqual(frags[0].entries.map(e => e.uid), [1, 2]);
});

test('fail-open: a null-filter entry groups alone (sharp) and forces null union (book)', () => {
  const sharp = partitionByAudience([E(null, 1), E(['aisha'], 2)]);
  assert.equal(sharp.length, 2);
  assert.equal(sharp.find(g => g.entries[0].uid === 1).characterFilter, null);
  assert.equal(audienceUnion([E(null, 1), E(['aisha'], 2)]), null);
  assert.equal(planRollupFragments([E(null, 1), E(['aisha'], 2)], 3)[0].characterFilter, null);
});

test('witnessPromptFragment: distinct sharp vs soft instructions', () => {
  assert.notEqual(witnessPromptFragment(true), witnessPromptFragment(false));
  assert.match(witnessPromptFragment(true), /broad|public|blur/i);
  assert.equal(SHARP_MAX_TIER, 2);
});
