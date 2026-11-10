import test from 'node:test';
import assert from 'node:assert/strict';
import { cellPosition, nextFrame, sheetSize } from './sprite.js';

test('nextFrame steps through a looping row and wraps to the first frame', () => {
  const seen = [0];
  for (let i = 0; i < 7; i++) seen.push(nextFrame(seen[seen.length - 1], 4, true)!);
  assert.deepEqual(seen, [0, 1, 2, 3, 0, 1, 2, 3]);
});
test('nextFrame stops a play-once row after its last frame', () => {
  assert.equal(nextFrame(2, 4, false), 3);
  assert.equal(nextFrame(3, 4, false), null);
});
test('a one-frame row loops on itself', () => {
  assert.equal(nextFrame(0, 1, true), 0);
});
test('cellPosition shifts the sheet one window per frame and per row', () => {
  assert.equal(cellPosition(0, 0), '0vw 0vh');
  assert.equal(cellPosition(7, 5), '-500vw -700vh');
});
test('sheetSize scales the sheet so one cell fills the window', () => {
  assert.equal(sheetSize(8, 11), '800vw 1100vh');
});
