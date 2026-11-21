import test from 'node:test';
import assert from 'node:assert/strict';
import { compactBounds, fitPosition, petPosition, roomForPet } from './bounds';

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
  assert.deepEqual(roomForPet({ x: 500, y: 20, ...size }, 104, main), { x: 500, y: 104, ...size });
});
test('the pet stays on screen when the box is dragged high', () => {
  assert.deepEqual(petPosition({ x: 500, y: 50, ...size }, pet, main), { x: 632, y: 0 });
});
test('the pet stays on screen when the box hangs off the left or right edge', () => {
  assert.equal(petPosition({ x: -300, y: 300, ...size }, pet, main).x, 0);
  assert.equal(petPosition({ x: 1800, y: 300, ...size }, pet, main).x, 1824);
});
test('the pet follows the box onto a second monitor at negative coordinates', () => {
  assert.deepEqual(petPosition({ x: -1000, y: 300, ...size }, pet, left), { x: -868, y: 196 });
  const above = { x: 0, y: -1080, width: 1920, height: 1040 };
  assert.deepEqual(petPosition({ x: 500, y: -1060, ...size }, pet, above), { x: 632, y: -1080 });
  assert.deepEqual(roomForPet({ x: 500, y: -1060, ...size }, 104, above), { x: 500, y: -976, ...size });
});
test('a box with room for the pet stays where it is', () => {
  assert.deepEqual(roomForPet({ x: 500, y: 104, ...size }, 104, main), { x: 500, y: 104, ...size });
  assert.deepEqual(roomForPet({ x: -1000, y: 300, ...size }, 104, left), { x: -1000, y: 300, ...size });
});
test('a box too tall for the room left under the pet shrinks to fit the screen', () => {
  assert.deepEqual(roomForPet({ x: 0, y: 0, width: 1920, height: 1040 }, 104, main), { x: 0, y: 104, width: 1920, height: 936 });
});

// Compact box: the anchor is the window's bottom-center; the window is 384 wide.
const bar = { width: 384, height: 76 };
test('the compact box is centered on the anchor and ends at its bottom', () => {
  assert.deepEqual(compactBounds({ cx: 960, bottom: 800 }, bar, 104, main), { x: 768, y: 724, ...bar });
});
test('a taller compact box grows upward from the same bottom edge', () => {
  assert.deepEqual(compactBounds({ cx: 960, bottom: 800 }, { width: 384, height: 504 }, 104, main), { x: 768, y: 296, width: 384, height: 504 });
});
test('near the top of the screen the compact box moves down so the pet fits', () => {
  assert.deepEqual(compactBounds({ cx: 960, bottom: 300 }, { width: 384, height: 504 }, 104, main), { x: 768, y: 104, width: 384, height: 504 });
});
test('on a screen too short for the pet and the box, the compact box shrinks', () => {
  const short = { x: 0, y: 0, width: 1280, height: 500 };
  assert.deepEqual(compactBounds({ cx: 640, bottom: 400 }, { width: 384, height: 504 }, 104, short), { x: 448, y: 104, width: 384, height: 396 });
});
test('the compact box uses the anchor on a second monitor', () => {
  assert.deepEqual(compactBounds({ cx: -960, bottom: 800 }, bar, 104, left), { x: -1152, y: 724, ...bar });
  const above = { x: 0, y: -1080, width: 1920, height: 1040 };
  assert.deepEqual(compactBounds({ cx: 960, bottom: -1050 }, bar, 104, above), { x: 768, y: -976, ...bar });
});
test('collapsing after an expansion that was pushed down puts the bar back on the anchor', () => {
  const anchor = { cx: 960, bottom: 300 };
  assert.equal(compactBounds(anchor, { width: 384, height: 504 }, 104, main).y, 104); // pushed down, below the anchor
  const back = compactBounds(anchor, bar, 104, main);
  assert.equal(back.y + back.height, 300);
});
test('a bar dragged to the very top of a monitor keeps the pet visible in every mode', () => {
  for (const area of [main, { x: 0, y: -1080, width: 1920, height: 1040 }]) {
    for (const height of [76, 300, 504]) {
      assert.ok(compactBounds({ cx: 960, bottom: area.y + 76 }, { width: 384, height }, 104, area).y >= area.y + 104);
    }
  }
});
