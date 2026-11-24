import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PET_ID, parseSettings, petSettings, toolSettings, uiSettings } from './settings';

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
  for (const id of ['../x', 'x.', '', '-x', 'a'.repeat(65), 5, null]) assert.equal(petSettings({ pet: { id } }).id, DEFAULT_PET_ID);
});
test('a pet setting that is not an object falls back to the defaults', () => {
  for (const pet of [true, 'cat', null]) assert.deepEqual(petSettings({ pet } as never), { enabled: true, id: DEFAULT_PET_ID });
});

test('compact mode is on when nothing is set', () => {
  assert.deepEqual(uiSettings({}), { compact: true });
});
test('ui.compact false keeps the full box', () => {
  assert.deepEqual(uiSettings({ ui: { compact: false } }), { compact: false });
});
test('a bad ui.compact or ui falls back to compact', () => {
  for (const compact of ['false', 0, null]) assert.equal(uiSettings({ ui: { compact } }).compact, true);
  for (const ui of [false, 'x', null]) assert.equal(uiSettings({ ui } as never).compact, true);
});

test('web tools are on when nothing is set', () => {
  assert.deepEqual(toolSettings({}), { webSearch: true, webFetch: true });
});
test('only a real false turns a web tool off', () => {
  for (const v of ['false', 0, null, true]) assert.deepEqual(toolSettings({ tools: { webSearch: v, webFetch: v } }), { webSearch: true, webFetch: true });
  assert.deepEqual(toolSettings({ tools: { websearch: false, WebFetch: false } }), { webSearch: true, webFetch: true });
});
test('a tools setting that is not an object leaves the web tools on', () => {
  for (const tools of [false, 'off', null, []]) assert.deepEqual(toolSettings({ tools }), { webSearch: true, webFetch: true });
});
test('webSearch false turns off search only', () => {
  assert.deepEqual(toolSettings({ tools: { webSearch: false } }), { webSearch: false, webFetch: true });
});
