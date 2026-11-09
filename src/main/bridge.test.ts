import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeBridge } from './bridge';

const fast = () => new FakeBridge({ waitMs: () => 0, wordMs: 0 });

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}

test('FakeBridge streams the echo word by word', async () => {
  const chunks = await collect(fast().send('c', 'hello there friend', new AbortController().signal));
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(''), 'hello there friend');
});
test('FakeBridge throws for /fail', async () => {
  await assert.rejects(collect(fast().send('c', '/fail now', new AbortController().signal)), /Fake bridge failure/);
});
test('FakeBridge stops when aborted mid-stream', async () => {
  const ac = new AbortController();
  const bridge = new FakeBridge({ waitMs: () => 0, wordMs: 1000 });
  const seen: string[] = [];
  await assert.rejects(async () => {
    for await (const c of bridge.send('c', 'one two three', ac.signal)) {
      seen.push(c);
      ac.abort();
    }
  }, { name: 'AbortError' });
  assert.deepEqual(seen, ['one ']);
});
test('FakeBridge rejects right away when already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(collect(fast().send('c', 'hi', ac.signal)), { name: 'AbortError' });
});
