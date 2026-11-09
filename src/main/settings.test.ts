import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from './settings';

test('returns a valid settings object', () => {
  assert.deepEqual(parseSettings('{"x":1,"y":2}'), { x: 1, y: 2 });
});
test('falls back to {} for JSON that is not an object', () => {
  for (const text of ['null', '5', '"x"', '[1]']) assert.deepEqual(parseSettings(text), {});
});
test('falls back to {} for invalid JSON', () => {
  assert.deepEqual(parseSettings('{oops'), {});
});
