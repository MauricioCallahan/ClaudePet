import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { command, findClaude, parseLine } from './claudeBridge';

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
