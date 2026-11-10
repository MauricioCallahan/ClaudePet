import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './errors';

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
