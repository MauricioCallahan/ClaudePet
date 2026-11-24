import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ApprovalPipe, Approvals, DENIED, RULE_DENIED, STOPPED, TIMED_OUT, ruleFor, type Card } from './approvals';
import type { Rules } from './settings';

test('ruleFor: the web tools run by default, everything else asks', () => {
  assert.equal(ruleFor('WebSearch', {}), 'allow');
  assert.equal(ruleFor('WebFetch', {}), 'allow');
  assert.equal(ruleFor('Bash', {}), 'ask');
  assert.equal(ruleFor('mcp__github__list_issues', {}), 'ask');
});
test('ruleFor: a rule for a whole MCP server covers its tools, and the exact tool wins over it', () => {
  const rules: Rules = { mcp__github: 'allow', mcp__github__create_issue: 'ask', mcp__claude_ai_Gmail: 'deny' };
  assert.equal(ruleFor('mcp__github__list_issues', rules), 'allow');
  assert.equal(ruleFor('mcp__github__create_issue', rules), 'ask');
  assert.equal(ruleFor('mcp__claude_ai_Gmail__search_threads', rules), 'deny'); // a server name with single underscores
  assert.equal(ruleFor('mcp__githubx__list', rules), 'ask'); // only the whole server name matches
  assert.equal(ruleFor('toString', {}), 'ask'); // nothing from Object's prototype
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
// WebFetch asks here (it runs without a card by default), so the queue tests get cards for it.
async function setup(o: { rules?: Rules; answerMs?: number } = {}) {
  const pipe = new ApprovalPipe();
  await pipe.listen();
  const shown: (Card | undefined)[] = [];
  const approvals = new Approvals(pipe, { command: 'x', args: [] }, (c) => shown.push(c), { rules: () => o.rules ?? { WebFetch: 'ask' }, answerMs: o.answerMs });
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

test('an allow or deny rule answers at once, with no card', async () => {
  const { pipe, approvals, shown } = await setup({ rules: { Bash: 'allow', mcp__github: 'deny' } });
  try {
    const s = approvals.begin('chat');
    assert.deepEqual(await request(pipe, s.env.CLAUDEPET_TOKEN, 'Bash', 'ta'), { allow: true });
    assert.deepEqual(await request(pipe, s.env.CLAUDEPET_TOKEN, 'mcp__github__create_issue', 'tb'), { allow: false, message: RULE_DENIED });
    assert.deepEqual(shown, []);
    assert.deepEqual([...s.answered], ['ta', 'tb']); // a rule's deny is an answer, not a tool that is off
    s.end();
  } finally {
    pipe.dispose();
  }
});

test('Allow for this chat lets the same tool through in that chat only, and forget clears it', async () => {
  const { pipe, approvals, shown, until, last } = await setup();
  try {
    const one = approvals.begin('one');
    const first = request(pipe, one.env.CLAUDEPET_TOKEN, 'Bash', 'ta');
    await until(() => !!last());
    approvals.answer(last()!.id, 'chat');
    assert.deepEqual(await first, { allow: true });
    const cards = shown.length;
    assert.deepEqual(await request(pipe, one.env.CLAUDEPET_TOKEN, 'Bash', 'tb'), { allow: true }); // no card this time
    assert.equal(shown.length, cards);
    one.end();
    const next = approvals.begin('one'); // the next message in the same chat still remembers
    assert.deepEqual(await request(pipe, next.env.CLAUDEPET_TOKEN, 'Bash', 'tc'), { allow: true });
    next.end();
    const other = approvals.begin('two'); // another chat asks again
    const asked = request(pipe, other.env.CLAUDEPET_TOKEN, 'Bash', 'td');
    await until(() => !!last());
    approvals.answer(last()!.id, 'deny');
    assert.equal(((await asked) as { allow: boolean }).allow, false);
    other.end();
    approvals.forget('one');
    const again = approvals.begin('one');
    const forgotten = request(pipe, again.env.CLAUDEPET_TOKEN, 'Bash', 'te');
    await until(() => !!last());
    again.end();
    assert.deepEqual(await forgotten, { allow: false, message: STOPPED });
  } finally {
    pipe.dispose();
  }
});

test('Allow for this chat also lets a waiting call of the same tool through', async () => {
  const { pipe, approvals, until, last } = await setup();
  try {
    const s = approvals.begin('chat');
    const a = request(pipe, s.env.CLAUDEPET_TOKEN, 'Bash', 'ta');
    await until(() => !!last());
    const b = request(pipe, s.env.CLAUDEPET_TOKEN, 'Bash', 'tb');
    const c = request(pipe, s.env.CLAUDEPET_TOKEN, 'WebFetch', 'tc');
    await until(() => last()?.total === 3);
    approvals.answer(last()!.id, 'chat');
    assert.deepEqual(await a, { allow: true });
    assert.deepEqual(await b, { allow: true });
    assert.equal(last()?.toolName, 'WebFetch'); // a different tool still asks
    assert.equal(last()?.index, 3);
    s.end();
    assert.equal(((await c) as { allow: boolean }).allow, false);
  } finally {
    pipe.dispose();
  }
});

test('no answer in time is a deny, and the card goes away', async () => {
  const { pipe, approvals, until, last } = await setup({ answerMs: 50 });
  try {
    const s = approvals.begin('chat');
    const a = request(pipe, s.env.CLAUDEPET_TOKEN, 'Bash', 'ta');
    await until(() => !!last());
    assert.deepEqual(await a, { allow: false, message: TIMED_OUT });
    assert.equal(last(), undefined);
    s.end();
  } finally {
    pipe.dispose();
  }
});
