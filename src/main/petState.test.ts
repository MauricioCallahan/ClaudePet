import test from 'node:test';
import assert from 'node:assert/strict';
import { playableRow, ROWS } from './petFormat';
import { nextState, STATE_ROW, type PetEvent, type PetState } from './petState';

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
];
for (const [from, e, to] of table) test(`${from} + ${e} → ${to}`, () => assert.equal(nextState(from, e), to));

test('each state plays its Codex row', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STATE_ROW).map(([s, r]) => [s, ROWS[r].state])),
    { idle: 'idle', thinking: 'running', replied: 'waving', error: 'failed' },
  );
});

test('a pet with only an idle row plays idle for every state', () => {
  for (const row of Object.values(STATE_ROW)) assert.equal(playableRow(row, 1), 0);
});

test('a full sheet plays each state row, and the still look rows fall back to idle', () => {
  for (const row of Object.values(STATE_ROW)) assert.equal(playableRow(row, 11), row);
  assert.equal(playableRow(9, 11), 0);
});
