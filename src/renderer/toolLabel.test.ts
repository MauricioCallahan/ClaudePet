import test from 'node:test';
import assert from 'node:assert/strict';
import { toolLabel } from './toolLabel.js';

test('WebSearch shows the query', () => {
  assert.deepEqual(toolLabel('WebSearch', { query: 'weather in Austin', mode: 'standard' }), {
    running: 'Searching the web for "weather in Austin"…',
    done: 'Searched the web for "weather in Austin"',
    failed: 'Web search failed',
  });
});
test('WebFetch shows the site without www, and "a web page" for a bad url', () => {
  assert.deepEqual(toolLabel('WebFetch', { url: 'https://www.example.com/a?b=1', prompt: 'x' }), {
    running: 'Reading example.com…',
    done: 'Read example.com',
    failed: "Couldn't read example.com",
  });
  for (const url of ['not a url', '', 5, undefined]) assert.equal(toolLabel('WebFetch', { url }).done, 'Read a web page');
});
test('an MCP tool shows the server and the tool in words', () => {
  assert.deepEqual(toolLabel('mcp__github__list_issues', {}), { running: 'Github: list issues…', done: 'Github: list issues', failed: 'Github: list issues failed' });
  assert.equal(toolLabel('mcp__claude_ai_Gmail__search_threads', {}).done, 'Claude ai Gmail: search threads');
  assert.equal(toolLabel('mcp__echo__echo__twice', {}).done, 'Echo: echo twice'); // split at the first "__"
});
test('any other tool is named as it is', () => {
  assert.deepEqual(toolLabel('Bash', { command: 'ls' }), { running: 'Using Bash…', done: 'Used Bash', failed: 'Bash failed' });
});
test('a long or multi-line query is cut to one short line', () => {
  const done = toolLabel('WebSearch', { query: `first line\n\n${'word '.repeat(40)}` }).done;
  assert.ok(!done.includes('\n'));
  assert.ok(done.includes('first line word word'));
  assert.ok(done.length <= 'Searched the web for ""'.length + 60);
  assert.ok(done.endsWith('…"'));
});
test('HTML in an input stays literal text', () => {
  assert.equal(toolLabel('WebSearch', { query: '<script>alert(1)</script>' }).done, 'Searched the web for "<script>alert(1)</script>"');
});
test('a missing or odd input still gives a label', () => {
  for (const input of [undefined, null, 'x', 5, [], { query: 7 }]) {
    assert.equal(toolLabel('WebSearch', input).done, 'Searched the web');
    assert.equal(toolLabel('WebFetch', input).done, 'Read a web page');
  }
});
