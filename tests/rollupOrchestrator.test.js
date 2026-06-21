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

// stub that returns zero usable summaries but carries the summarizer's debug fields,
// mirroring runSummaryAnalysisSequential's {summaryCandidates, leftovers, rawText, retryRawText}.
const makeNoUsableStub = () => {
  const calls = [];
  const summarize = async (entries, options) => {
    calls.push({ n: entries.length });
    return {
      summaryCandidates: [],
      leftovers: entries.map(e => e.uid),
      rawText: `RAW${calls.length}`,
      retryRawText: `RETRY${calls.length}`,
    };
  };
  return { summarize, calls };
};

test('flag ON: rawText/retryRawText carried forward when no usable summaries (back-compat)', async () => {
  const { summarize } = makeNoUsableStub();
  const entries = [E(['aisha', 'shilpa'], 1), E(['shilpa'], 2)];
  const res = await runWitnessRollup(entries, { targetTier: 1 }, null, { summarize, isTwoPlane: () => true });
  assert.equal(res.summaryCandidates.length, 0);
  // both fragments' debug text concatenated, so the "view failed response" popup is non-empty
  assert.match(res.rawText, /RAW1/);
  assert.match(res.rawText, /RAW2/);
  assert.match(res.retryRawText, /RETRY1/);
  assert.match(res.retryRawText, /RETRY2/);
});

test('flag ON: rawText/retryRawText keys present (defined) even with empty summarizer debug', async () => {
  const summarize = async (entries) => ({ summaryCandidates: [], leftovers: [] });
  const entries = [E(['aisha'], 1)];
  const res = await runWitnessRollup(entries, { targetTier: 1 }, null, { summarize, isTwoPlane: () => true });
  assert.equal(typeof res.rawText, 'string');
  assert.equal(typeof res.retryRawText, 'string');
});

test('FIX1 N5/U10 multi-pass: lockedSummaries are audience-filtered per fragment (no input-side cross-audience leak)', async () => {
  // Records the lockedSummaries each fragment's summarize call received.
  const seen = [];
  const summarize = async (entries, options) => {
    seen.push({
      auds: options.lockedSummaries ? options.lockedSummaries.map(L => L.id) : undefined,
      n: entries.length,
    });
    return { summaryCandidates: [{ title: 't', summary: 'x', memberIds: entries.map(e => e.uid) }], leftovers: [] };
  };
  // Three accepted summaries from prior passes, each carrying its own audience via characterFilter.
  const Lsum = (id, names) => ({ id, characterFilter: names === null ? null : { isExclude: false, names, tags: [] } });
  const lockedSummaries = [
    Lsum('priv-shilpa', ['shilpa']),         // {shilpa}-private
    Lsum('shared', ['aisha', 'shilpa']),     // {aisha,shilpa}
    Lsum('ungated', null),                    // everyone (ungated)
  ];
  // Two fragments: {aisha,shilpa} (uid 1,3) and {shilpa} (uid 2).
  const entries = [E(['aisha', 'shilpa'], 1), E(['shilpa'], 2), E(['aisha', 'shilpa'], 3)];
  await runWitnessRollup(entries, { targetTier: 1, lockedSummaries }, null, { summarize, isTwoPlane: () => true });
  assert.equal(seen.length, 2);
  // Map fragment by entry count: {aisha,shilpa} sees 2 entries, {shilpa} sees 1.
  const bigFrag = seen.find(s => s.n === 2);   // audience {aisha,shilpa}
  const smallFrag = seen.find(s => s.n === 1); // audience {shilpa}
  // {aisha,shilpa} fragment: a locked summary may be included ONLY IF A_F subset of A_L.
  // {aisha,shilpa} subset of {shilpa}? NO -> 'priv-shilpa' MUST be excluded (this is the leak).
  // {aisha,shilpa} subset of {aisha,shilpa}? YES -> 'shared' included. null A_L => always -> 'ungated' included.
  assert.deepEqual(bigFrag.auds.sort(), ['shared', 'ungated'].sort(),
    'the {aisha,shilpa} fragment must NOT receive the {shilpa}-private locked summary (input-side leak)');
  // {shilpa} fragment: {shilpa} subset of {shilpa} YES, subset of {aisha,shilpa} YES, null YES -> all three.
  assert.deepEqual(smallFrag.auds.sort(), ['priv-shilpa', 'shared', 'ungated'].sort(),
    'the {shilpa} fragment may read all three (its audience is a subset of every locked summary audience)');
});

test('FIX1 passthrough: options without a lockedSummaries array gets NO lockedSummaries key introduced', async () => {
  let sawKey = true;
  const summarize = async (entries, options) => {
    sawKey = ('lockedSummaries' in options);
    return { summaryCandidates: [{ title: 't', summary: 'x', memberIds: [] }], leftovers: [] };
  };
  await runWitnessRollup([E(['aisha'], 1)], { targetTier: 1 }, null, { summarize, isTwoPlane: () => true });
  assert.equal(sawKey, false, 'must not introduce a lockedSummaries key when options had none');
});

test('flag ON: each candidate gets its OWN characterFilter (no aliasing across siblings)', async () => {
  // one fragment, summarizer emits two candidates from the same fragment
  const summarize = async (entries, options) => ({
    summaryCandidates: [
      { title: 'A', summary: 'x', memberIds: entries.map(e => e.uid) },
      { title: 'B', summary: 'y', memberIds: entries.map(e => e.uid) },
    ],
    leftovers: [],
  });
  const entries = [E(['aisha', 'shilpa'], 1), E(['aisha', 'shilpa'], 2)];
  const res = await runWitnessRollup(entries, { targetTier: 1 }, null, { summarize, isTwoPlane: () => true });
  const [c0, c1] = res.summaryCandidates;
  // distinct object references for both the filter and its names array
  assert.notEqual(c0.characterFilter, c1.characterFilter);
  assert.notEqual(c0.characterFilter.names, c1.characterFilter.names);
  // in-place mutation of one must NOT leak into its sibling
  c0.characterFilter.names.push('leaked');
  c0.characterFilter.isExclude = true;
  assert.deepEqual(c1.characterFilter.names, ['aisha', 'shilpa']);
  assert.equal(c1.characterFilter.isExclude, false);
});
