import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpConfig } from './mcpConfig';

const stdio = { command: 'npx', args: ['-y', 'some-server'], env: { TOKEN: '${TOKEN}' }, extra: { keep: 1 } };
const http = { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } };

test('a valid file gives its servers, with unknown fields kept as written', () => {
  assert.deepEqual(parseMcpConfig(JSON.stringify({ mcpServers: { files: stdio, 'web-api_2': http, sse: { type: 'sse', url: 'https://x.test/sse' } } })), {
    servers: { files: stdio, 'web-api_2': http, sse: { type: 'sse', url: 'https://x.test/sse' } },
  });
});
test('an empty or blank file, or an empty mcpServers, is no servers', () => {
  assert.deepEqual(parseMcpConfig(''), { servers: {} });
  assert.deepEqual(parseMcpConfig(' \n'), { servers: {} });
  assert.deepEqual(parseMcpConfig('{"mcpServers":{}}'), { servers: {} });
});
test('bad JSON gives an error that does not repeat the file', () => {
  const r = parseMcpConfig('{"mcpServers": {"x": {"command": "secret-value"');
  assert.ok('error' in r && /not valid JSON/.test(r.error));
  assert.ok(!('error' in r && r.error.includes('secret-value')));
});
test('a file without an mcpServers object is an error', () => {
  for (const text of ['null', '[]', '5', '{}', '{"mcpServers":[]}', '{"mcpServers":"x"}']) assert.ok('error' in parseMcpConfig(text), text);
});
test('names that are unsafe or would break tool names are refused', () => {
  for (const name of ['My Server', 'Upper', 'a__b', 'a_', '-a', '', 'a&b', 'a'.repeat(65), '../x'])
    assert.match((parseMcpConfig(JSON.stringify({ mcpServers: { [name]: stdio } })) as { error: string }).error, /not allowed/, name);
});
test('claudepet is reserved', () => {
  assert.match((parseMcpConfig(JSON.stringify({ mcpServers: { claudepet: stdio } })) as { error: string }).error, /reserved/);
});
test('an entry with neither a command nor a url, or with bad fields, is an error naming the server', () => {
  for (const entry of [null, 'x', [], {}, { command: '' }, { command: 'x', args: 'a' }, { command: 'x', args: [1] }, { type: 'http' }, { type: 'http', url: 5 }, { type: 'ws', url: 'x' }]) {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { srv: entry } }));
    assert.ok('error' in r && r.error.includes('"srv"'), JSON.stringify(entry));
  }
});
