import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isChatId, makeTitle, matches, parseChats, parseMessages, recent, rename, setSession, transcriptPath, upsert } from './chats';

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
    { mode: 'chat', createdAt: 1, id: 'a', title: 'first', updatedAt: 3 },
    { mode: 'chat', createdAt: 2, id: 'b', title: 'other', updatedAt: 2 },
  ]);
});
test('setSession stores the session id and upsert keeps it', () => {
  let c = upsert([], 'a', 'first', 1);
  c = setSession(c, 'a', 's1');
  c = setSession(c, 'missing', 's2');
  c = upsert(c, 'a', 'again', 2);
  assert.deepEqual(c, [{ mode: 'chat', createdAt: 1, id: 'a', title: 'first', updatedAt: 2, sessionId: 's1' }]);
});
test('parseChats drops a chat whose sessionId is not a string', () => {
  const text = JSON.stringify([{ id: 'a', title: 't', updatedAt: 1, sessionId: 5 }, { id: 'b', title: 't', updatedAt: 1, sessionId: 's' }]);
  assert.deepEqual(parseChats(text).map((c) => c.id), ['b']);
});
test('a new chat is a chat-mode chat, and upsert keeps an existing mode', () => {
  const c = upsert([{ id: 'a', title: 't', updatedAt: 1, mode: 'code' }], 'a', 'again', 2);
  assert.equal(c[0].mode, 'code');
  assert.equal(upsert([], 'b', 'hi', 1)[0].mode, 'chat');
});
test('parseChats keeps chats without a mode and drops unknown modes', () => {
  const text = JSON.stringify([{ id: 'a', title: 't', updatedAt: 1 }, { id: 'b', title: 't', updatedAt: 1, mode: 'agent' }, { id: 'c', title: 't', updatedAt: 1, mode: 'code' }]);
  assert.deepEqual(parseChats(text).map((c) => c.id), ['a', 'c']);
});
test('recent sorts newest first and limits', () => {
  const c = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: '', updatedAt: i }));
  const r = recent(c);
  assert.equal(r.length, 10);
  assert.equal(r[0].id, '11');
});
test('parseMessages keeps valid messages and falls back to [] for a corrupt file', () => {
  const ok = { role: 'user', text: 'hi', at: 1 };
  const text = JSON.stringify([ok, { role: 'system', text: 'x', at: 1 }, { role: 'claude', text: 5, at: 1 }, null]);
  assert.deepEqual(parseMessages(text), [ok]);
  for (const bad of ['', '{"a":', 'null', '{}']) assert.deepEqual(parseMessages(bad), []);
});
test('isChatId accepts uuids and refuses anything that could leave the chats folder', () => {
  assert.ok(isChatId(crypto.randomUUID()));
  for (const bad of ['', '../x', 'a/b', 'a\\b', 'x.json', 'x'.repeat(101), 5, null]) assert.equal(isChatId(bad), false, String(bad));
});
test('parseChats keeps createdAt and drops a non-number one', () => {
  const text = JSON.stringify([{ id: 'a', title: 't', updatedAt: 2, createdAt: 1 }, { id: 'b', title: 't', updatedAt: 1, createdAt: 'x' }]);
  assert.deepEqual(parseChats(text).map((c) => c.id), ['a']);
});
test('matches finds a word in the title or any message, ignoring case', () => {
  const chat = { id: 'a', title: 'Trip to Lisbon', updatedAt: 1 };
  const msgs = [{ role: 'user' as const, text: 'Pack a Raincoat?', at: 1 }];
  for (const q of ['lisbon', 'RAINCOAT', ' trip ', '', '  ']) assert.ok(matches(chat, msgs, q), q);
  assert.equal(matches(chat, msgs, 'paris'), false);
  assert.equal(matches(chat, [], 'raincoat'), false);
});
test('rename trims the title and ignores an empty one', () => {
  const c = [{ id: 'a', title: 'old', updatedAt: 1 }];
  assert.equal(rename(c, 'a', '  new\n title ')[0].title, 'new title');
  assert.equal(rename(c, 'a', '   ')[0].title, 'old');
  assert.equal(rename(c, 'a', 'x'.repeat(150))[0].title.length, 100);
});
test('transcriptPath names the file Claude Code writes, and only for a uuid', () => {
  const s = '0c42d79a-5eee-4841-845f-2cb52763161c';
  assert.equal(
    transcriptPath('C:\\Users\\me\\.claude', 'C:\\Users\\me\\AppData\\Roaming\\claudepet\\workspace', s),
    path.join('C:\\Users\\me\\.claude', 'projects', 'C--Users-me-AppData-Roaming-claudepet-workspace', `${s}.jsonl`),
  );
  for (const bad of ['', '../../x', `${s}/../x`, 'not-a-uuid']) assert.equal(transcriptPath('c', 'w', bad), undefined, bad);
});
