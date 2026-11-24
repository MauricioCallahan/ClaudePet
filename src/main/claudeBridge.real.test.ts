// Runs the bridge against your installed, signed-in Claude Code. It spends real usage (four one-line haiku replies),
// so it is not part of `npm test`; run it with `npm run test:real`.
// It checks what the Retry fix relies on: where Claude Code keeps a session's transcript, that a turn only appends
// to it, and that a session cut back after a failed turn still resumes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptPath } from './chats';
import { ClaudeBridge, findClaude } from './claudeBridge';
import { BridgeError } from './errors';

const exe = findClaude(process.env, fs.existsSync, os.homedir());
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

test('real Claude Code: a failed turn is taken out of the transcript and the session still resumes', { skip: !exe && 'Claude Code is not installed', timeout: 300_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-real-'));
  const cwd = path.join(dir, 'workspace');
  let session: string | undefined;
  const sizes: number[] = []; // the transcript's size each time the bridge asks for it: before a turn, and in the undo
  const bridge = new ClaudeBridge({
    exe: () => exe,
    cwd,
    sessions: { get: () => session, set: (_id, s) => (session = s) },
    transcript: (s) => {
      const t = transcriptPath(configDir, cwd, s);
      if (t && fs.existsSync(t)) sizes.push(fs.statSync(t).size);
      return t;
    },
    mode: () => 'chat',
    model: () => 'haiku',
    tools: () => ({ webSearch: false, webFetch: false }),
    instructions: () => undefined,
    promptFile: path.join(dir, 'prompt.md'),
    idleMs: 120_000,
  });
  const run = async (text: string) => {
    let reply = '';
    for await (const chunk of bridge.send('real', text, new AbortController().signal)) reply += chunk;
    return reply;
  };
  const file = () => transcriptPath(configDir, cwd, session!)!;
  try {
    assert.match(await run('Reply with only the word: one'), /one/i);
    assert.ok(session, 'Claude Code reported no session id');
    assert.ok(fs.existsSync(file()), `no transcript at ${file()}`);

    // A normal turn only appends.
    const afterOne = fs.readFileSync(file());
    assert.match(await run('Reply with only the word: two'), /two/i);
    const afterTwo = fs.readFileSync(file());
    assert.ok(afterTwo.length > afterOne.length && afterTwo.subarray(0, afterOne.length).equals(afterOne), 'the second turn rewrote the start of the transcript');

    // Offline: a proxy that refuses every connection, so Claude Code retries with no response and the bridge stops it.
    const sessionBefore = session;
    const proxy = { HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY };
    Object.assign(process.env, { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' });
    let failed: unknown;
    try {
      await run('Reply with only the word: three');
    } catch (err) {
      failed = err;
    } finally {
      for (const [k, v] of Object.entries(proxy)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
    assert.ok(failed instanceof BridgeError && failed.info.retry, `expected an error with Retry, got ${failed}`);
    assert.ok(sizes.at(-1)! > afterTwo.length, 'the failed turn never reached the transcript, so the undo was not exercised');
    assert.equal(session, sessionBefore);
    assert.ok(fs.readFileSync(file()).equals(afterTwo), 'the failed turn is still in the transcript');

    // Retry: the cut-back session resumes, and "three" is in it once.
    assert.match(await run('Reply with only the word: three'), /three/i);
    const userTurns = fs
      .readFileSync(file(), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((v) => v.type === 'user' && JSON.stringify(v.message ?? '').includes('three'));
    assert.equal(userTurns.length, 1, 'the retried prompt reached the session more than once');
  } finally {
    const t = session && transcriptPath(configDir, cwd, session);
    if (t) fs.rmSync(path.dirname(t), { recursive: true, force: true }); // this test's own project folder in Claude Code
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
