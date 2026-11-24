import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ApprovalPipe, Approvals, DENIED, STOPPED, ruleFor, type Card } from './approvals';

test('ruleFor: the web tools run by default, everything else asks', () => {
  assert.equal(ruleFor('WebSearch', {}), 'allow');
  assert.equal(ruleFor('WebFetch', {}), 'allow');
  assert.equal(ruleFor('Bash', {}), 'ask');
  assert.equal(ruleFor('mcp__github__list_issues', {}), 'ask');
});
test('ruleFor: a rule for the exact tool wins over the default', () => {
  assert.equal(ruleFor('WebFetch', { WebFetch: 'ask' }), 'ask');
  assert.equal(ruleFor('WebSearch', { WebSearch: 'deny' }), 'deny');
  assert.equal(ruleFor('Bash', { Bash: 'allow' }), 'allow');
});

// Sends one request the way the approval server does, and resolves with main's answer.
function request(pipe: ApprovalPipe, token: string, tool_name: string, tool_use_id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const socket = net.connect(pipe.name, () => socket.write(JSON.stringify({ token, tool_name, input: { n: tool_use_id }, tool_use_id }) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => (buf += d));
    socket.on('end', () => resolve(JSON.parse(buf)));
    socket.on('error', reject);
  });
}
async function setup() {
  const pipe = new ApprovalPipe();
  await pipe.listen();
  const shown: (Card | undefined)[] = [];
  const approvals = new Approvals(pipe, { command: 'x', args: [] }, (c) => shown.push(c));
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(ok(), 'timed out');
  };
  return { pipe, approvals, shown, until, last: () => shown[shown.length - 1] };
}

test('two requests at once show one card at a time, counted 1 of 2 then 2 of 2', async () => {
  const { pipe, approvals, shown, until, last } = await setup();
  try {
    const s = approvals.begin('chat');
    const a = request(pipe, s.env.CLAUDEPET_TOKEN, 'WebFetch', 'ta');
    await until(() => !!last());
    const b = request(pipe, s.env.CLAUDEPET_TOKEN, 'Bash', 'tb');
    await until(() => last()?.total === 2);
    assert.deepEqual({ ...last(), id: '' }, { id: '', toolName: 'WebFetch', input: { n: 'ta' }, index: 1, total: 2 });
    assert.equal(approvals.answer(last()!.id, 'once'), true);
    assert.deepEqual(await a, { allow: true });
    assert.equal(last()?.toolName, 'Bash');
    assert.equal(last()?.index, 2);
    assert.equal(last()?.total, 2);
    assert.equal(approvals.answer(last()!.id, 'deny'), true);
    assert.deepEqual(await b, { allow: false, message: DENIED });
    assert.equal(last(), undefined); // no card left
    assert.deepEqual([...s.answered].sort(), ['ta', 'tb']);
    assert.ok(shown.length >= 3);
    s.end();
  } finally {
    pipe.dispose();
  }
});

test('only the card on screen can be answered, with a known answer', async () => {
  const { pipe, approvals, until, last } = await setup();
  try {
    const s = approvals.begin('chat');
    const a = request(pipe, s.env.CLAUDEPET_TOKEN, 'WebFetch', 'ta');
    await until(() => !!last());
    const id = last()!.id;
    for (const [card, ans] of [['made-up', 'once'], [id, 'always'], [id, undefined], [undefined, 'once']] as const) assert.equal(approvals.answer(card, ans), false);
    assert.equal(approvals.answer(id, 'chat'), true);
    assert.deepEqual(await a, { allow: true });
    assert.equal(approvals.answer(id, 'once'), false); // already answered
    s.end();
  } finally {
    pipe.dispose();
  }
});

test('ending the reply denies its open cards and removes them', async () => {
  const { pipe, approvals, until, last } = await setup();
  try {
    const s = approvals.begin('chat');
    const a = request(pipe, s.env.CLAUDEPET_TOKEN, 'WebFetch', 'ta');
    await until(() => !!last());
    s.end();
    assert.deepEqual(await a, { allow: false, message: STOPPED });
    assert.equal(last(), undefined);
    assert.equal((await request(pipe, s.env.CLAUDEPET_TOKEN, 'WebFetch', 'tb') as { allow: boolean }).allow, false); // the token is dead
  } finally {
    pipe.dispose();
  }
});
