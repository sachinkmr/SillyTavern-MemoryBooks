// tests/witnessRollupWiring.test.js
//
// Phase 3 review finding #5: the Task-3 WIRING in arcanalysis.js / index.js was previously
// untested -- the green suite only covered the pure rollupScope/rollupOrchestrator modules, so
// the witness-leak bypasses in the job path and preview-regenerate callbacks passed CI silently.
//
// These tests exercise the REAL arcanalysis.js (imported through a host-module stub loader, since
// arcanalysis.js statically imports SillyTavern host modules that don't exist under node --test)
// and assert on the index.js SOURCE for the routing invariants. They assert:
//   (a) runSummaryAnalysisSequential appends options.witnessPrompt to the prompt actually sent to
//       the model, and is a no-op when no witnessPrompt is passed (legacy path).
//   (b) commitSummaryEntries writes entryOverrides.characterFilter when the flag is ON and the
//       candidate carries a gate, and leaves it UNSET for a null filter and when the flag is OFF.
//   (c) every Consolidate execution path in index.js (synchronous, queued job, and BOTH preview
//       regenerate callbacks) routes through runWitnessRollup -- never raw
//       runSummaryAnalysisSequential -- so no path can drop witness partitioning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = new URL('../', import.meta.url); // .../SillyTavern-MemoryBooks/
const repoFile = (rel) => pathToFileURL(fileURLToPath(new URL(rel, REPO_ROOT))).href;

// --- Register the host-module stub loader BEFORE importing any repo module that needs it. ---
register(repoFile('tests/helpers/stHostStubLoader.mjs'), import.meta.url);

// --- Minimal browser-global shim: repo modules touch window/jQuery/document at module top-level. ---
const jq = () => ({ length: 0, on() { return this; }, find() { return jq(); }, val() { return undefined; }, text() { return this; }, append() { return this; }, each() { return this; } });
globalThis.window = globalThis.window || { jQuery: jq };
globalThis.document = globalThis.document || { querySelector: () => null, querySelectorAll: () => [] };
globalThis.jQuery = globalThis.jQuery || jq;
globalThis.$ = globalThis.$ || jq;
globalThis.navigator = globalThis.navigator || { userAgent: 'node' };
globalThis.toastr = globalThis.toastr || { info() {}, warning() {}, error() {}, success() {}, clear() {} };
// Shared mutable extension_settings (the two-plane flag lives here); the stub loader binds every
// host `extension_settings` import to this same object.
globalThis.__STMB_EXT_SETTINGS__ = globalThis.__STMB_EXT_SETTINGS__ || { STMemoryBooks: { moduleSettings: {} } };
const setTwoPlane = (on) => { globalThis.__STMB_EXT_SETTINGS__.STMemoryBooks.moduleSettings.twoPlaneMemory = !!on; };

// Real arcanalysis.js (resolved through the stub loader).
const arc = await import(repoFile('arcanalysis.js'));

// --- fetch shim: capture the prompt sent to the model and return a canned summary JSON. ---
let lastSentPrompt = null;
function installFetchCapture(modelJson) {
    lastSentPrompt = null;
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        lastSentPrompt = body.messages[0].content;
        const payload = JSON.stringify({ choices: [{ message: { content: modelJson } }] });
        return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, text: async () => payload };
    };
}
// 'full-manual' conn => a single direct OpenAI-compatible fetch we can intercept.
const directConn = { api: 'full-manual', model: 'm', endpoint: 'http://stmb.test.local', temperature: 0.2 };
const twoEntries = [
    { uid: 1, comment: '[001] A', content: 'aaa', key: [] },
    { uid: 2, comment: '[002] B', content: 'bbb', key: [] },
];
const cannedSummary = JSON.stringify({
    summaries: [{ title: 'T', summary: 'sum', member_ids: ['1', '2'] }],
    unassigned_items: [],
});

// =========================================================================================
// (a) witnessPrompt threading into the prompt sent to the model
// =========================================================================================

test('(a) runSummaryAnalysisSequential appends options.witnessPrompt to the model prompt', async () => {
    setTwoPlane(true);
    installFetchCapture(cannedSummary);
    const marker = 'WITNESS-MARKER-7Q same audience';
    const res = await arc.runSummaryAnalysisSequential(
        twoEntries,
        { targetTier: 1, minAssigned: 2, witnessPrompt: marker },
        directConn,
    );
    assert.equal(res.summaryCandidates.length, 1);
    assert.ok(lastSentPrompt && lastSentPrompt.includes(marker),
        'the witness instruction must be present in the prompt text sent to the model');
});

test('(a) legacy no-op: no witnessPrompt => prompt carries no witness instruction', async () => {
    setTwoPlane(false);
    installFetchCapture(cannedSummary);
    const res = await arc.runSummaryAnalysisSequential(
        twoEntries,
        { targetTier: 1, minAssigned: 2 },
        directConn,
    );
    assert.equal(res.summaryCandidates.length, 1);
    assert.ok(lastSentPrompt && !/same audience|blur private attribution|publicly-known strokes/i.test(lastSentPrompt),
        'with no witnessPrompt the prompt must be unchanged (no witness instruction)');
});

// =========================================================================================
// (b) commitSummaryEntries characterFilter stamping (flag-gated, null = ungated)
// =========================================================================================

async function commitOne(flag, candidate) {
    setTwoPlane(flag);
    globalThis.__STMB_UPSERT_CALLS__ = [];
    await arc.commitSummaryEntries({
        lorebookName: 'LB',
        lorebookData: { entries: {} },
        summaryCandidates: [candidate],
        targetTier: 1,
    });
    const write = (globalThis.__STMB_UPSERT_CALLS__ || []).find((c) => c?.entry?.entryOverrides);
    return write?.entry?.entryOverrides || {};
}

const gatedCandidate = () => ({ title: 'T', summary: 's', memberIds: ['1'], keywords: ['k'], characterFilter: { isExclude: false, names: ['aisha', 'shilpa'], tags: [] } });

test('(b) flag ON + gated candidate => entryOverrides.characterFilter is stamped', async () => {
    const ov = await commitOne(true, gatedCandidate());
    assert.deepEqual(ov.characterFilter, { isExclude: false, names: ['aisha', 'shilpa'], tags: [] });
});

test('(b) flag ON + null filter => characterFilter left UNSET (fail-open, ungated)', async () => {
    const ov = await commitOne(true, { title: 'T', summary: 's', memberIds: ['1'], keywords: ['k'], characterFilter: null });
    assert.ok(!('characterFilter' in ov), 'a null characterFilter must NOT be written (stays ungated like legacy)');
});

test('(b) flag OFF => characterFilter never written (byte-identical legacy)', async () => {
    const ov = await commitOne(false, gatedCandidate());
    assert.ok(!('characterFilter' in ov), 'with twoPlaneMemory OFF the stamp guard must be a no-op');
});

// =========================================================================================
// (c) index.js routing invariants: NO Consolidate path may call raw runSummaryAnalysisSequential
// =========================================================================================

const indexSrc = readFileSync(fileURLToPath(new URL('index.js', REPO_ROOT)), 'utf8');

test('(c) the synchronous Consolidate OK handler routes through runWitnessRollup', () => {
    assert.match(indexSrc, /analysis = await runWitnessRollup\(selectedEntries, options, null\)/,
        'the inline Consolidate path must call runWitnessRollup');
});

test('(c) the QUEUED consolidation job initial analysis routes through runWitnessRollup', () => {
    // executeQueuedConsolidationJob must not summarize the whole selection witness-blind.
    const jobStart = indexSrc.indexOf('async function executeQueuedConsolidationJob');
    assert.ok(jobStart >= 0, 'executeQueuedConsolidationJob must exist');
    const jobBody = indexSrc.slice(jobStart, jobStart + 4000);
    assert.match(jobBody, /const analysis = await runWitnessRollup\(/,
        'the queued job must compute its initial analysis via runWitnessRollup, not raw runSummaryAnalysisSequential');
});

test('(c) NO Consolidate path calls raw runSummaryAnalysisSequential (all 4 sites routed)', () => {
    // The only legitimate caller of runSummaryAnalysisSequential is runWitnessRollup itself,
    // which lives in arcanalysis.js -- index.js must never call it directly anymore.
    const rawCalls = indexSrc.match(/\brunSummaryAnalysisSequential\s*\(/g) || [];
    assert.equal(rawCalls.length, 0,
        `index.js must not call runSummaryAnalysisSequential directly (found ${rawCalls.length}); ` +
        'every Consolidate path (sync, queued job, and both preview-regenerate callbacks) must route through runWitnessRollup');
});

test('(c) both preview-regenerate callbacks route through runWitnessRollup', () => {
    // generateAnalysis callbacks (sync preview ~6997 and queued preview ~3869) feed retry/next-pass.
    const generateAnalysisRouted = indexSrc.match(/generateAnalysis: async \(entries, lockedSummaries\) => \{[\s\S]*?return await runWitnessRollup\(/g) || [];
    assert.equal(generateAnalysisRouted.length, 2,
        `both generateAnalysis callbacks must route through runWitnessRollup (found ${generateAnalysisRouted.length} of 2)`);
});
