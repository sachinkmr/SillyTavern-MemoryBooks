// tests/rollupScope.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audienceNamesOf, partitionByAudience, audienceUnion, audienceSubsetOf,
  planRollupFragments, witnessPromptFragment, SHARP_MAX_TIER,
} from '../rollupScope.js';

const E = (names, id) => ({ uid: id, characterFilter: names === null ? null : { isExclude: false, names, tags: [] } });

test('audienceNamesOf: null filter => null (everyone); names normalized+sorted', () => {
  assert.equal(audienceNamesOf(E(null, 1)), null);
  assert.deepEqual(audienceNamesOf(E(['shilpa', 'aisha', 'aisha'], 1)), ['aisha', 'shilpa']);
});

test('audienceSubsetOf: all four quadrants incl. null-fragment leak guard', () => {
  // null sup (locked summary witnessed by everyone) => always allowed into any fragment
  assert.equal(audienceSubsetOf(['aisha'], null), true);
  assert.equal(audienceSubsetOf(null, null), true);
  // null sub (everyone-readable fragment) + non-null sup (private summary) => EXCLUDE (the leak guard)
  assert.equal(audienceSubsetOf(null, ['shilpa']), false);
  // non-null/non-null: subset/equal allowed, anything not fully covered excluded
  assert.equal(audienceSubsetOf(['shilpa'], ['aisha', 'shilpa']), true);   // F readers subset of L witnesses
  assert.equal(audienceSubsetOf(['aisha', 'shilpa'], ['aisha', 'shilpa']), true);
  assert.equal(audienceSubsetOf(['aisha', 'shilpa'], ['shilpa']), false);  // aisha didn't witness L => leak
  assert.equal(audienceSubsetOf(['ravi'], ['shilpa']), false);            // disjoint
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

test('WITNESS-LEAK regression: adjacent/concatenable names do NOT collapse into one audience', () => {
  // join('') collapsed {'Bo','bby'} and the {'Bobby'} singleton to the same key 'Bobby'.
  const seg1 = E(['Bo', 'bby'], 1), seg2 = E(['Bobby'], 2);
  const frags = planRollupFragments([seg1, seg2], 1); // sharp tier => one fragment per distinct audience
  assert.equal(frags.length, 2, 'distinct audiences must stay in separate fragments');
  const fTwo = frags.find(f => f.characterFilter.names.length === 2);
  const fOne = frags.find(f => f.characterFilter.names.length === 1);
  assert.deepEqual(fTwo.characterFilter.names, ['Bo', 'bby']);
  assert.deepEqual(fOne.characterFilter.names, ['Bobby']);
  // The {Bobby}-private entry must NOT be summarized inside the {Bo,bby} fragment.
  assert.ok(!fTwo.entries.some(e => e.uid === 2), 'private {Bobby} entry must not leak into {Bo,bby} fragment');
  assert.deepEqual(fOne.entries.map(e => e.uid), [2]);

  // Second documented collision: {'Ann','asol'} vs {'Anna','sol'} both keyed to 'Annasol'.
  const f2 = planRollupFragments([E(['Ann', 'asol'], 10), E(['Anna', 'sol'], 11)], 1);
  assert.equal(f2.length, 2, "{'Ann','asol'} and {'Anna','sol'} must not collide");
  assert.ok(!f2.find(f => f.characterFilter.names[0] === 'Ann').entries.some(e => e.uid === 11));
});

test('isExclude is NOT treated as an include-audience: exclude-filter fails open (null)', () => {
  const excl = { uid: 1, characterFilter: { isExclude: true, names: ['aisha'], tags: [] } };
  // Must not be grouped/stamped identically to an include-filter for aisha.
  assert.equal(audienceNamesOf(excl), null);
  // It groups with everyone (fail-open), separate from a real include {aisha}.
  const groups = partitionByAudience([excl, E(['aisha'], 2)]);
  assert.equal(groups.length, 2);
  const exclGroup = groups.find(g => g.entries[0].uid === 1);
  assert.equal(exclGroup.characterFilter, null, 'exclude entry must be ungated (fail-open), not gated to aisha');
  assert.equal(audienceUnion([excl, E(['aisha'], 2)]), null, 'an exclude filter forces fail-open union');
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

test('tier 2 (chapter) over MIXED audience is SHARP: per-audience fragments, soft=false (pins inclusive SHARP_MAX_TIER=2)', () => {
  // An off-by-one (tier < SHARP_MAX_TIER instead of <=) would make chapter SOFT/union and slip a leak through.
  const frags = planRollupFragments([E(['aisha', 'shilpa'], 1), E(['shilpa'], 2), E(['aisha', 'shilpa'], 3)], 2);
  assert.equal(frags.length, 2, 'chapter (tier 2) must stay SHARP: one fragment per distinct audience');
  assert.ok(frags.every(f => f.soft === false), 'every chapter fragment must be sharp (soft=false)');
  const fx = frags.find(f => f.characterFilter.names.length === 2);
  const fy = frags.find(f => f.characterFilter.names.length === 1);
  assert.deepEqual(fx.entries.map(e => e.uid), [1, 3]);
  assert.deepEqual(fy.entries.map(e => e.uid), [2]);
  assert.deepEqual(fy.characterFilter.names, ['shilpa']);
});

test('sharpMaxTier injection honored: planRollupFragments(mixed, 2, {sharpMaxTier:1}) => SOFT single union fragment', () => {
  const frags = planRollupFragments([E(['aisha', 'shilpa'], 1), E(['shilpa'], 2)], 2, { sharpMaxTier: 1 });
  assert.equal(frags.length, 1, 'with sharpMaxTier lowered to 1, tier 2 falls into the soft/union branch');
  assert.equal(frags[0].soft, true);
  assert.deepEqual(frags[0].characterFilter.names, ['aisha', 'shilpa']);
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
