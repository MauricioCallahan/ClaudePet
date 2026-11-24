import test from 'node:test';
import assert from 'node:assert/strict';
import { playableRow, ROWS } from './petFormat';
import { setTimeout as sleep } from 'node:timers/promises';
import { FakeBridge } from './bridge';
import { createMood, nextState, STATE_ROW, type PetEvent, type PetState } from './petState';

// Every (state, event) pair: [from, event, to].
const table: [PetState, PetEvent, PetState][] = [
  ['idle', 'send', 'thinking'],
  ['idle', 'end', 'idle'],
  ['idle', 'error', 'error'],
  ['idle', 'stop', 'idle'],
  ['idle', 'settle', 'idle'],
  ['thinking', 'send', 'thinking'],
  ['thinking', 'end', 'replied'],
  ['thinking', 'error', 'error'],
  ['thinking', 'stop', 'idle'],
  ['thinking', 'settle', 'thinking'],
  ['replied', 'send', 'thinking'],
  ['replied', 'end', 'replied'],
  ['replied', 'error', 'error'],
  ['replied', 'stop', 'idle'],
  ['replied', 'settle', 'idle'],
  ['error', 'send', 'thinking'],
  ['error', 'end', 'error'],
  ['error', 'error', 'error'],
  ['error', 'stop', 'idle'],
  ['error', 'settle', 'idle'],
  ['idle', 'tool', 'idle'],
  ['idle', 'text', 'idle'],
  ['thinking', 'tool', 'working'],
  ['thinking', 'text', 'thinking'],
  ['working', 'send', 'thinking'],
  ['working', 'tool', 'working'],
  ['working', 'text', 'thinking'],
  ['working', 'end', 'replied'],
  ['working', 'error', 'error'],
  ['working', 'stop', 'idle'],
  ['working', 'settle', 'working'],
  ['replied', 'tool', 'replied'],
  ['replied', 'text', 'replied'],
  ['error', 'tool', 'error'],
  ['error', 'text', 'error'],
];
for (const [from, e, to] of table) test(`${from} + ${e} → ${to}`, () => assert.equal(nextState(from, e), to));

test('each state plays its Codex row', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STATE_ROW).map(([s, r]) => [s, ROWS[r].state])),
    { idle: 'idle', thinking: 'running', working: 'running-right', replied: 'waving', error: 'failed' },
  );
});

test('a pet with only an idle row plays idle for every state', () => {
  for (const row of Object.values(STATE_ROW)) assert.equal(playableRow(row, 1), 0);
});

test('a full sheet plays each state row, and the still look rows fall back to idle', () => {
  for (const row of Object.values(STATE_ROW)) assert.equal(playableRow(row, 11), row);
  assert.equal(playableRow(9, 11), 0);
});

// Plays one FakeBridge reply into a mood, with the same three endings as runReply in main.ts.
const bridge = new FakeBridge({ waitMs: () => 0, wordMs: 0 });
async function reply(mood: ReturnType<typeof createMood>, text: string, stop = false): Promise<void> {
  const ac = new AbortController();
  mood.event('send');
  try {
    for await (const ev of bridge.send('c', text, ac.signal)) {
      if (stop) ac.abort();
      // Like runReply: a tool start works, its done (the only tool) or the next text goes back to thinking.
      mood.event(typeof ev === 'string' || 'toolDone' in ev ? 'text' : 'tool');
    }
    mood.event('end');
  } catch {
    mood.event(ac.signal.aborted ? 'stop' : 'error');
  }
}
function recorder(visible = () => true) {
  const played: PetState[] = [];
  return { played, mood: createMood({ play: (s) => played.push(s), visible, settleMs: 20 }) };
}
const settled = () => sleep(80);

test('a normal reply: thinking, replied, then idle on its own', async () => {
  const { played, mood } = recorder();
  await reply(mood, 'hello there');
  assert.deepEqual(played, ['thinking', 'replied']);
  await settled();
  assert.deepEqual(played, ['thinking', 'replied', 'idle']);
});

test('an error: thinking, error, then idle on its own', async () => {
  const { played, mood } = recorder();
  await reply(mood, '/fail');
  await settled();
  assert.deepEqual(played, ['thinking', 'error', 'idle']);
});

test('Stop: thinking, then straight back to idle', async () => {
  const { played, mood } = recorder();
  await reply(mood, 'one two three', true);
  await settled();
  assert.deepEqual(played, ['thinking', 'idle']);
});

test('a reply that ends while the box is hidden waves when the box is shown, then settles', async () => {
  let visible = false;
  const { played, mood } = recorder(() => visible);
  await reply(mood, 'hello');
  await settled();
  assert.deepEqual(played, ['thinking', 'replied']); // no settle while hidden
  visible = true;
  mood.shown();
  assert.deepEqual(played, ['thinking', 'replied', 'replied']); // replayed from its first frame
  await settled();
  assert.deepEqual(played, ['thinking', 'replied', 'replied', 'idle']);
});

test('a reply with a tool: thinking, working, thinking, replied', async () => {
  const { played, mood } = recorder();
  await reply(mood, '/tool cats');
  assert.deepEqual(played, ['thinking', 'working', 'thinking', 'replied']);
});

test('a new message cancels a pending settle', async () => {
  const { played, mood } = recorder();
  await reply(mood, 'first');
  mood.event('send');
  await settled();
  assert.deepEqual(played, ['thinking', 'replied', 'thinking']);
});
