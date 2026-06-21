import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directedMetaForSegment, buildShellEntry } from '../shell.js';

const ROSTER = [
  { name: 'Shilpa', avatar: 'Shilpa.png' }, { name: 'Aisha', avatar: 'Aisha.png' },
  { name: 'Priya', avatar: 'Priya.png' },
];
// a segment whose messages carry a directed stamp at chat[id].extra.channel
function dirSeg(ids, channel) {
  const chat = []; ids.forEach(i => { chat[i] = { extra: { channel } }; });
  return { seg: { filteredScene: { messages: ids.map(i => ({ id: i })) }, audience: channel.audience }, chat };
}

test('U6 whisper: shell to bystander Aisha names the target; content stays with participants', () => {
  const { seg, chat } = dirSeg([0], {
    type: 'whisper', audience: ['sachin', 'shilpa'], present_cast: ['sachin', 'shilpa', 'aisha'],
    from: 'sachin', to: ['shilpa'],
  });
  const meta = directedMetaForSegment(seg, chat);
  const shell = buildShellEntry(meta, seg.audience, ROSTER, { userToken: 'sachin' });
  assert.match(shell.content, /whispered/i);
  assert.match(shell.content, /Shilpa/);                              // whisper names the target
  assert.deepEqual(shell.characterFilter.names, ['Aisha']);          // gated to the bystander only
  assert.deepEqual(shell.suggestedKeys, []);
  assert.equal(shell.shell, true);
});

test('U8 text to REMOTE target: shell hides the target ("someone")', () => {
  const { seg, chat } = dirSeg([0], {
    type: 'text', audience: ['sachin', 'shilpa'], present_cast: ['sachin', 'aisha', 'shilpa'],
    from: 'sachin', to: ['shilpa'], remote: ['shilpa'],
  });
  const shell = buildShellEntry(directedMetaForSegment(seg, chat), seg.audience, ROSTER, { userToken: 'sachin' });
  assert.match(shell.content, /texting/i);
  assert.match(shell.content, /someone/i);                           // remote target hidden
  assert.doesNotMatch(shell.content, /Shilpa/);                      // N4: target name not leaked
  assert.deepEqual(shell.characterFilter.names, ['Aisha']);
});

test('U7 text to a PRESENT char: shell names the present target; gated to the bystander', () => {
  const { seg, chat } = dirSeg([0], {
    type: 'text', audience: ['sachin', 'shilpa'], present_cast: ['sachin', 'shilpa', 'aisha'],
    from: 'sachin', to: ['shilpa'], remote: [],                       // Shilpa present (not remote)
  });
  const shell = buildShellEntry(directedMetaForSegment(seg, chat), seg.audience, ROSTER, { userToken: 'sachin' });
  assert.match(shell.content, /texting/i);
  assert.match(shell.content, /Shilpa/);                              // present target IS named
  assert.deepEqual(shell.characterFilter.names, ['Aisha']);
});

test('E4/N10 no bystander: no shell', () => {
  const { seg, chat } = dirSeg([0], {
    type: 'whisper', audience: ['sachin', 'shilpa'], present_cast: ['sachin', 'shilpa'],
    from: 'sachin', to: ['shilpa'],
  });
  assert.equal(buildShellEntry(directedMetaForSegment(seg, chat), seg.audience, ROSTER, { userToken: 'sachin' }), null);
});

test('M1: user-initiated whisper shows the user display name, not the lowercased token', () => {
  const { seg, chat } = dirSeg([0], {
    type: 'whisper', audience: ['sachin', 'shilpa'], present_cast: ['sachin', 'shilpa', 'aisha'],
    from: 'sachin', to: ['shilpa'],
  });
  const shell = buildShellEntry(directedMetaForSegment(seg, chat), seg.audience, ROSTER, { userToken: 'sachin', userName: 'Sachin' });
  assert.match(shell.content, /Sachin whispered/);   // resolved display name, not 'sachin'
  assert.equal(shell.fromDisplay, 'Sachin');
});

test('non-directed segment → directedMetaForSegment returns null (no shell, E1 thoughts handled upstream)', () => {
  const chat = [{ extra: { channel: { audience: ['sachin', 'aisha'] } } }];  // no present_cast
  const seg = { filteredScene: { messages: [{ id: 0 }] }, audience: ['sachin', 'aisha'] };
  assert.equal(directedMetaForSegment(seg, chat), null);
});
