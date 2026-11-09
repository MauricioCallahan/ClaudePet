import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { command, findClaude } from './claudeBridge';

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
