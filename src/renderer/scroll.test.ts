import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStick } from './scroll.js';

test('sticks when exactly at the bottom', () => {
  assert.equal(shouldStick(600, 400, 1000), true);
});

test('sticks within the slack', () => {
  assert.equal(shouldStick(580, 400, 1000), true);
});

test('does not stick once scrolled up past the slack', () => {
  assert.equal(shouldStick(500, 400, 1000), false);
});

test('sticks when content is shorter than the view', () => {
  assert.equal(shouldStick(0, 400, 200), true);
});
