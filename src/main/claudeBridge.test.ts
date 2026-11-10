import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildArgs, command, findClaude, parseLine, shellArgs } from './claudeBridge';

test('buildArgs resumes only with a well-formed session id', () => {
  const id = '730602b1-d89c-41bf-9f2d-54bc04302aef';
  assert.deepEqual(buildArgs({ sessionId: id }).slice(-2), ['--resume', id]);
  for (const bad of [undefined, '', 'abc', `${id} & calc`, '--dangerously-skip-permissions']) assert.ok(!buildArgs({ sessionId: bad }).includes('--resume'));
});
test('buildArgs turns off tools and the user setup in chat mode (the default) only', () => {
  const chat = buildArgs();
  assert.equal(chat[chat.indexOf('--tools') + 1], '');
  assert.equal(chat[chat.indexOf('--setting-sources') + 1], '');
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands']) assert.ok(chat.includes(flag));
  assert.deepEqual(buildArgs({ mode: 'chat' }), chat);
  assert.ok(!buildArgs({ mode: 'code' }).includes('--tools'));
});
test('shellArgs quotes empty values only when going through a shell', () => {
  assert.deepEqual(shellArgs(['--tools', '', '-p'], true), ['--tools', '""', '-p']);
  assert.deepEqual(shellArgs(['--tools', ''], false), ['--tools', '']);
});

const only = (...files: string[]) => (f: string) => files.includes(f);
const home = path.join('home', 'me');
const local = path.join(home, '.local', 'bin', 'claude.exe');

test('findClaude prefers PATH over the known install locations', () => {
  const onPath = path.join('bin', 'claude.cmd');
  const env = { PATH: ['other', 'bin'].join(path.delimiter) };
  assert.equal(findClaude(env, only(onPath, local), home), onPath);
  assert.equal(findClaude(env, only(local), home), local);
});
test('findClaude checks the npm folder under APPDATA', () => {
  const npm = path.join('appdata', 'npm', 'claude.cmd');
  assert.equal(findClaude({ APPDATA: 'appdata' }, only(npm), home), npm);
});
test('findClaude returns undefined when nothing is installed', () => {
  assert.equal(findClaude({ PATH: 'bin' }, () => false, home), undefined);
  assert.equal(findClaude({}, () => false, home), undefined);
});
test('findClaude uses the override and does not fall back when it is missing', () => {
  const env = { CLAUDEPET_CLAUDE: 'fake.cmd', PATH: 'bin' };
  assert.equal(findClaude(env, only('fake.cmd'), home), 'fake.cmd');
  assert.equal(findClaude(env, only(path.join('bin', 'claude.exe')), home), undefined);
});
test('command quotes .cmd files and runs them through a shell', () => {
  assert.deepEqual(command('C:\\a b\\claude.cmd'), { file: '"C:\\a b\\claude.cmd"', shell: true });
  assert.deepEqual(command('C:\\a b\\claude.exe'), { file: 'C:\\a b\\claude.exe', shell: false });
});

const init = '{"type":"system","subtype":"init","cwd":"C:\\\\x","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef","tools":[]}';
const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
const result = '{"type":"result","subtype":"success","is_error":false,"result":"hi there","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}';

test('parseLine reads the session id, text deltas and the final result', () => {
  assert.deepEqual(parseLine(init), { sessionId: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
  assert.deepEqual(parseLine(delta('hi there')), { chunk: 'hi there' });
  assert.deepEqual(parseLine(result), { sessionId: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
});

test('parseLine: a multi-chunk reply joins to the full text', () => {
  const lines = [init, delta('Hello'), delta(', wor'), delta('ld!\n'), result];
  const text = lines.map((l) => parseLine(l)?.chunk ?? '').join('');
  assert.equal(text, 'Hello, world!\n');
});
test('parseLine: an error result carries the message and no session id', () => {
  const line = '{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}';
  assert.deepEqual(parseLine(line), { error: 'Invalid API key · Please run /login' });
  assert.deepEqual(parseLine('{"type":"result","subtype":"error_during_execution","is_error":true}'), { error: 'Claude Code reported an error.' });
});
test('parseLine: a denied tool ends the reply with an error, even though the result says success', () => {
  // Recorded from claude 2.1.321 with --permission-prompts none (usage and other fields trimmed).
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'The command was blocked.', session_id: '6c0baf1c-cc0a-4f43-8d71-1194d5c4a136', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_01', tool_input: { command: 'echo hi > x.txt' } }] });
  assert.deepEqual(parseLine(line), { error: 'Claude Code asked to use Bash, but tools are off in pet chats.' });
  assert.deepEqual(parseLine(JSON.stringify({ type: 'result', is_error: false, permission_denials: [], session_id: 's' })), { sessionId: 's' });
});
test('buildArgs never lets a permission prompt wait for an answer, in any mode', () => {
  for (const mode of ['chat', 'code'] as const) assert.equal(buildArgs({ mode }).join(' ').includes('--permission-prompts none'), true);
});
test('parseLine: truncated or non-JSON lines are ignored, not thrown', () => {
  for (const line of [delta('cut off').slice(0, 60), '', 'Warning: something on stdout', 'null', '5', '"text"']) assert.equal(parseLine(line), null);
});
test('parseLine: lines that are not reply text are ignored', () => {
  const lines = [
    '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"system","subtype":"status","status":"requesting","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}}',
    '{"type":"stream_event","event":{"type":"message_stop"}}',
    // The whole message again: counting it would show every reply twice.
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]},"session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  ];
  for (const line of lines) assert.equal(parseLine(line), null);
});
