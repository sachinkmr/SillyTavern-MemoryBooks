// tests/rollupOrchestrator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWitnessRollup } from '../rollupOrchestrator.js';

const E = (names, id) => ({ uid: id, characterFilter: { isExclude: false, names, tags: [] } });
// stub summarizer: one candidate per call, echoing how many entries it saw + the witnessPrompt it got
const makeStub = () => {
  const calls = [];
  const summarize = async (entries, options) => {
    calls.push({ n: entries.length, witnessPrompt: options.witnessPrompt });
    return { summaryCandidates: [{ title: `S${calls.length}`, summary: 'x', memberIds: entries.map(e => e.uid) }], leftovers: [] };
  };
  return { summarize, calls };
};

test('flag OFF: single passthrough call, no characterFilter stamping', async () => {
  const { summarize, calls } = makeStub();
  const entries = [E(['aisha', 'shilpa'], 1), E(['shilpa'], 2)];
  const res = await runWitnessRollup(entries, { targetTier: 1 }, null, { summarize, isTwoPlane: () => false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].n, 2);
  assert.equal(res.summaryCandidates[0].characterFilter, undefined);
});

test('flag ON, tier 1 mixed: one summarize call per fragment; candidates stamped', async () => {
  const { summarize, calls } = makeStub();
  const entries = [E(['aisha', 'shilpa'], 1), E(['shilpa'], 2), E(['aisha', 'shilpa'], 3)];
  const res = await runWitnessRollup(entries, { targetTier: 1 }, null, { summarize, isTwoPlane: () => true });
  assert.equal(calls.length, 2);                              // two fragments
  assert.ok(calls.every(c => /same audience/i.test(c.witnessPrompt))); // sharp prompt threaded
  const big = res.summaryCandidates.find(c => c.characterFilter.names.length === 2);
  const small = res.summaryCandidates.find(c => c.characterFilter.names.length === 1);
  assert.deepEqual(big.memberIds, [1, 3]);
  assert.deepEqual(small.characterFilter.names, ['shilpa']);
});

test('flag ON, tier 3 book: single UNION call, soft prompt, union characterFilter', async () => {
  const { summarize, calls } = makeStub();
  const entries = [E(['aisha', 'shilpa'], 1), E(['shilpa'], 2)];
  const res = await runWitnessRollup(entries, { targetTier: 3 }, null, { summarize, isTwoPlane: () => true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].witnessPrompt, /broad|public|blur/i);
  assert.deepEqual(res.summaryCandidates[0].characterFilter.names, ['aisha', 'shilpa']);
});
