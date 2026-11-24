import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { ApprovalPipe } from '../main/approvals';
import { decide, toVerdict, NO_ANSWER } from './decide';

test('decide gives Claude Code allow with the input unchanged, or deny with the message', () => {
  const text = (r: ReturnType<typeof decide>) => JSON.parse(r.content[0].text);
  assert.deepEqual(text(decide({ allow: true }, { url: 'https://example.com' })), { behavior: 'allow', updatedInput: { url: 'https://example.com' } });
  assert.deepEqual(text(decide({ allow: false, message: 'No.' }, { url: 'x' })), { behavior: 'deny', message: 'No.' });
  assert.equal(decide({ allow: true }, {}).content.length, 1);
});
test('toVerdict denies anything that is not a clear allow', () => {
  assert.deepEqual(toVerdict({ allow: true }), { allow: true });
  for (const v of [null, undefined, 'allow', {}, { allow: 'true' }, { allow: 1 }]) assert.deepEqual(toVerdict(v), { allow: false, message: NO_ANSWER });
  assert.deepEqual(toVerdict({ allow: false, message: 'Denied.' }), { allow: false, message: 'Denied.' });
});

// Starts the built server like Claude Code does and talks MCP to it over stdio.
function startServer(env: Record<string, string>) {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map<number, (m: any) => void>();
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let next = 1;
  const call = (method: string, params?: object) =>
    new Promise<any>((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const approve = async (args: object) => JSON.parse((await call('tools/call', { name: 'approve', arguments: args })).result.content[0].text);
  return { child, call, approve };
}

test('the approval server forwards each request with its token and answers allow or deny', async () => {
  const pipe = new ApprovalPipe();
  await pipe.listen();
  const seen: unknown[] = [];
  const token = pipe.open(async (req) => {
    seen.push(req);
    return req.toolName === 'WebFetch' ? { allow: true } : { allow: false, message: 'You said no.' };
  });
  const s = startServer({ CLAUDEPET_PIPE: pipe.name, CLAUDEPET_TOKEN: token });
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    s.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); // no reply expected
    const list = await s.call('tools/list');
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ['approve']);
    assert.deepEqual(await s.approve({ tool_name: 'WebFetch', input: { url: 'https://example.com' }, tool_use_id: 't1' }), { behavior: 'allow', updatedInput: { url: 'https://example.com' } });
    assert.deepEqual(await s.approve({ tool_name: 'Bash', input: { command: 'dir' }, tool_use_id: 't2' }), { behavior: 'deny', message: 'You said no.' });
    assert.deepEqual(seen, [
      { toolName: 'WebFetch', input: { url: 'https://example.com' }, toolUseId: 't1' },
      { toolName: 'Bash', input: { command: 'dir' }, toolUseId: 't2' },
    ]);
    assert.equal((await s.call('nope')).error.code, -32601);
  } finally {
    s.child.kill();
    pipe.dispose();
  }
});

test('a wrong or closed token, or no pipe at all, is a deny', async () => {
  const pipe = new ApprovalPipe();
  await pipe.listen();
  let asked = 0;
  const token = pipe.open(async () => (asked++, { allow: true }));
  const wrong = startServer({ CLAUDEPET_PIPE: pipe.name, CLAUDEPET_TOKEN: 'not-the-token' });
  const right = startServer({ CLAUDEPET_PIPE: pipe.name, CLAUDEPET_TOKEN: token });
  const gone = startServer({ CLAUDEPET_PIPE: pipe.name + '-missing', CLAUDEPET_TOKEN: token });
  try {
    const req = { tool_name: 'WebFetch', input: {} };
    assert.equal((await wrong.approve(req)).behavior, 'deny');
    assert.equal((await right.approve(req)).behavior, 'allow');
    pipe.close(token); // the reply ended: its token is no longer good
    assert.equal((await right.approve(req)).behavior, 'deny');
    assert.deepEqual(await gone.approve(req), { behavior: 'deny', message: NO_ANSWER });
    assert.equal(asked, 1);
  } finally {
    for (const s of [wrong, right, gone]) s.child.kill();
    pipe.dispose();
  }
});

test('the approval server exits when Claude Code closes its stdin', async () => {
  const s = startServer({ CLAUDEPET_PIPE: 'x', CLAUDEPET_TOKEN: 'y' });
  const code = new Promise((r) => s.child.once('exit', r));
  s.child.stdin.end();
  assert.equal(await code, 0);
});
