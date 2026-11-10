import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PET_ID, parseSettings, petSettings } from './settings';

test('returns a valid settings object', () => {
  assert.deepEqual(parseSettings('{"x":1,"y":2}'), { x: 1, y: 2 });
});
test('keeps a hotkey string', () => {
  assert.deepEqual(parseSettings('{"hotkey":"Alt+Space"}'), { hotkey: 'Alt+Space' });
});
test('falls back to {} for JSON that is not an object', () => {
  for (const text of ['null', '5', '"x"', '[1]']) assert.deepEqual(parseSettings(text), {});
});
test('falls back to {} for invalid JSON', () => {
  assert.deepEqual(parseSettings('{oops'), {});
});

test('the pet is on with the default pet when nothing is set', () => {
  assert.deepEqual(petSettings({}), { enabled: true, id: DEFAULT_PET_ID });
});
test('keeps a valid pet setting', () => {
  assert.deepEqual(petSettings({ pet: { enabled: false, id: 'holy-knight' } }), { enabled: false, id: 'holy-knight' });
});
test('a non-boolean pet.enabled falls back to on', () => {
  for (const enabled of ['false', 0, null]) assert.equal(petSettings({ pet: { enabled } }).enabled, true);
});
test('a bad pet.id falls back to the default pet', () => {
  for (const id of ['../x', 'Holy', '', '-x', 'a'.repeat(65), 5, null]) assert.equal(petSettings({ pet: { id } }).id, DEFAULT_PET_ID);
});
test('a pet setting that is not an object falls back to the defaults', () => {
  for (const pet of [true, 'cat', null]) assert.deepEqual(petSettings({ pet } as never), { enabled: true, id: DEFAULT_PET_ID });
});
