import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTitle, parseChats, recent, setSession, upsert } from './chats';

test('parseChats keeps valid entries and drops malformed ones', () => {
  const text = JSON.stringify([{ id: 'a', title: 't', updatedAt: 1 }, { id: 2 }, null, 'x']);
  assert.deepEqual(parseChats(text), [{ id: 'a', title: 't', updatedAt: 1 }]);
});
test('parseChats falls back to [] for non-arrays and invalid JSON', () => {
  for (const text of ['null', '{}', '5', '{oops']) assert.deepEqual(parseChats(text), []);
});
test('makeTitle collapses whitespace and truncates', () => {
  assert.equal(makeTitle('  hi \n there '), 'hi there');
  assert.equal(makeTitle('x'.repeat(50)), 'x'.repeat(39) + '…');
});
test('upsert keeps the first title and moves the chat to the front', () => {
  let c = upsert([], 'a', 'first', 1);
  c = upsert(c, 'b', 'other', 2);
  c = upsert(c, 'a', 'second message', 3);
  assert.deepEqual(c, [
    { id: 'a', title: 'first', updatedAt: 3 },
    { id: 'b', title: 'other', updatedAt: 2 },
  ]);
});
test('setSession stores the session id and upsert keeps it', () => {
  let c = upsert([], 'a', 'first', 1);
  c = setSession(c, 'a', 's1');
  c = setSession(c, 'missing', 's2');
  c = upsert(c, 'a', 'again', 2);
  assert.deepEqual(c, [{ id: 'a', title: 'first', updatedAt: 2, sessionId: 's1' }]);
});
test('parseChats drops a chat whose sessionId is not a string', () => {
  const text = JSON.stringify([{ id: 'a', title: 't', updatedAt: 1, sessionId: 5 }, { id: 'b', title: 't', updatedAt: 1, sessionId: 's' }]);
  assert.deepEqual(parseChats(text).map((c) => c.id), ['b']);
});
test('recent sorts newest first and limits', () => {
  const c = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: '', updatedAt: i }));
  const r = recent(c);
  assert.equal(r.length, 10);
  assert.equal(r[0].id, '11');
});
