import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPosition, petPosition, roomForPet } from './bounds';

const size = { width: 360, height: 480 };
const main = { x: 0, y: 0, width: 1920, height: 1040 };
const left = { x: -1920, y: 0, width: 1920, height: 1040 };

test('keeps an on-screen position', () => {
  assert.deepEqual(fitPosition({ x: 100, y: 100 }, size, [main], main), { x: 100, y: 100 });
});
test('falls back to bottom-right when off the right edge', () => {
  assert.deepEqual(fitPosition({ x: 5000, y: 5000 }, size, [main], main), { x: 1544, y: 544 });
});
test('keeps a position on a second monitor that exists', () => {
  assert.deepEqual(fitPosition({ x: -1000, y: 50 }, size, [main, left], main), { x: -1000, y: 50 });
});
test('falls back when that second monitor is gone', () => {
  assert.deepEqual(fitPosition({ x: -1000, y: 50 }, size, [main], main), { x: 1544, y: 544 });
});

const pet = { width: 96, height: 104 };
test('the pet stands centered on the box top edge', () => {
  assert.deepEqual(petPosition({ x: 500, y: 300, ...size }, pet, main), { x: 632, y: 196 });
});
test('the pet is rounded to whole pixels', () => {
  assert.deepEqual(petPosition({ x: 500, y: 300, width: 361, height: 480 }, pet, main), { x: 633, y: 196 });
});
test('a box too close to the top moves down to make room for the pet', () => {
  assert.deepEqual(roomForPet({ x: 500, y: 20, ...size }, 104, main), { x: 500, y: 104 });
});
