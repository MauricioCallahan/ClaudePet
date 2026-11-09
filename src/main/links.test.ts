import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebUrl } from './links';

test('allows http and https', () => {
  assert.equal(isWebUrl('http://example.com'), true);
  assert.equal(isWebUrl('https://example.com/a?b=1#c'), true);
});
test('rejects other schemes', () => {
  for (const u of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:', 'mailto:a@b.c']) {
    assert.equal(isWebUrl(u), false, u);
  }
});
test('rejects things that are not URLs', () => {
  assert.equal(isWebUrl(''), false);
  assert.equal(isWebUrl('not a url'), false);
  assert.equal(isWebUrl('example.com'), false);
});
