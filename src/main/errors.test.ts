import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, describe, INSTALL_URL, toBridgeError } from './errors';
import { isWebUrl } from './links';

// Sample texts as Claude Code 2.1.321 and Windows report them.
const samples: [string, number | null | undefined, string][] = [
  ['not-installed', 9009, "'claude' is not recognized as an internal or external command,\r\noperable program or batch file."],
  ['not-installed', undefined, 'spawn C:\\Users\\me\\.local\\bin\\claude.exe ENOENT'],
  ['not-installed', undefined, 'Claude Code is not installed.'],
  ['not-signed-in', 1, 'Not logged in · Please run /login'],
  ['not-signed-in', 1, 'Invalid API key · Please run /login'],
  ['not-signed-in', 1, 'API Error: 401 OAuth token has expired. Please obtain a new token or refresh your existing token.'],
  ['not-signed-in', 1, 'Authentication required · Sign in again to continue'],
  ['usage-limit', 1, "You've hit your limit · resets 5pm (Europe/Berlin)"],
  ['usage-limit', 1, 'Claude AI usage limit reached|1736985600'],
  ['usage-limit', 1, "You've hit your session limit · resets 3pm"],
  ['usage-limit', 1, 'Weekly limit reached ∙ resets Mon 9am'],
  ['network', 1, 'API Error: Connection error.'],
  ['network', 1, 'Request timed out. Check your internet connection and proxy settings'],
  ['network', 1, 'API Error: getaddrinfo ENOTFOUND api.anthropic.com'],
  ['network', 1, 'TypeError: fetch failed'],
  ['unknown', 1, 'Context limit reached · /compact or /clear to continue'],
  ['unknown', 1, 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'],
  ['unknown', 1, 'Claude Code asked to use Bash, but tools are off in pet chats.'],
  ['unknown', 1, ''],
];

test('classify recognizes each known case from sample output', () => {
  for (const [want, code, text] of samples) assert.equal(classify(text, code), want, text);
});
test('classify: exit code 9009 means not installed even with no output', () => {
  assert.equal(classify('', 9009), 'not-installed');
  assert.equal(classify('', 1), 'unknown');
});
test('describe gives the fix for not installed (with the install link) and not signed in', () => {
  const missing = describe('not-installed', 'spawn claude ENOENT');
  assert.equal(missing.link, INSTALL_URL);
  assert.ok(isWebUrl(missing.link!));
  assert.match(describe('not-signed-in', 'Not logged in · Please run /login').message, /Run `claude` once in a terminal and sign in/);
});
test('describe keeps the text of an unknown error as Claude Code reported it', () => {
  assert.deepEqual(describe('unknown', 'API Error: 529 Overloaded'), { case: 'unknown', message: 'API Error: 529 Overloaded' });
});
test('toBridgeError classifies the detail', () => {
  assert.equal(toBridgeError('Not logged in · Please run /login', 1).info.case, 'not-signed-in');
  assert.equal(toBridgeError('', 9009).message, describe('not-installed', '').message);
});
test('describe: the usage limit says when it resets, if Claude Code reported it', () => {
  const resetsAt = Date.UTC(2026, 10, 9, 17, 0) / 1000;
  const { message } = describe('usage-limit', "You've hit your limit", resetsAt);
  assert.match(message, /usage limit\. It resets \S/);
  assert.ok(message.includes(new Date(resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })));
  assert.equal(describe('usage-limit', 'Usage limit reached').message, "You've reached your Claude usage limit. Try again later.");
});
test('toBridgeError: a rejected rate_limit_event makes it the usage limit, whatever the text', () => {
  assert.equal(toBridgeError('API Error: 429', 1, 1736985600).info.case, 'usage-limit');
});
