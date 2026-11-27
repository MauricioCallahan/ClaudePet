import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpConfig, parseMcpStatus, redact, statusLine } from './mcpConfig';

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

// The mcp parts of a real init line from claude 2.1.331 (recorded 2026-11-24): echo started, "broken" has a command that
// does not exist, "needsauth" is an http server that needs OAuth, "badurl" has no url.
export const REAL_INIT = {
  type: 'system',
  subtype: 'init',
  session_id: '11111111-2222-4333-8444-555555555555',
  mcp_servers: [
    { name: 'echo', status: 'connected', source: 'dynamic' },
    { name: 'broken', status: 'failed', source: 'dynamic' },
    { name: 'needsauth', status: 'needs-auth', source: 'dynamic' },
    { name: 'claudepet', status: 'connected', source: 'dynamic' },
  ],
  mcp_server_errors: [{ name: 'badurl', type: 'invalid_config', message: 'Skipped — invalid MCP server config for "badurl": url: expected string, received undefined' }],
};

test('parseMcpStatus reads the real init line: statuses by name, an invalid entry with its message, and not the approval server', () => {
  assert.deepEqual(parseMcpStatus(REAL_INIT), [
    { name: 'echo', status: 'connected' },
    { name: 'broken', status: 'failed' },
    { name: 'needsauth', status: 'needs-auth' },
    { name: 'badurl', status: 'invalid', error: REAL_INIT.mcp_server_errors[0].message },
  ]);
});
test('parseMcpStatus: no server lists is undefined, an empty list is none, odd entries are skipped', () => {
  assert.equal(parseMcpStatus({ type: 'system' }), undefined);
  assert.equal(parseMcpStatus(null), undefined);
  assert.deepEqual(parseMcpStatus({ mcp_servers: [] }), []);
  assert.deepEqual(parseMcpStatus({ mcp_servers: [null, 5, { name: 1, status: 'x' }, { name: 'a' }, { name: 'ok', status: 'connected' }], mcp_server_errors: 'x' }), [{ name: 'ok', status: 'connected' }]);
});
test('statusLine: nothing for a connected server; a reason for a failed, invalid or needs-auth one', () => {
  assert.equal(statusLine({ name: 'echo', status: 'connected' }), undefined);
  assert.match(statusLine({ name: 'broken', status: 'failed' })!, /^broken failed: .*"command" or "url"/);
  assert.match(statusLine({ name: 'needsauth', status: 'needs-auth' })!, /^needsauth needs-auth: .*"headers"/);
  assert.match(statusLine({ name: 'badurl', status: 'invalid', error: 'url: expected string' })!, /^badurl invalid: url: expected string$/);
});
test('the log holds no env or header value, even when Claude Code repeats one in its message', () => {
  const server = { command: 'x', env: { TOKEN: 's3cr3t-value', N: '1' }, headers: { Authorization: 'Bearer s3cr3t-hdr' } };
  const line = statusLine({ name: 'srv', status: 'invalid', error: 'bad value s3cr3t-value and Bearer s3cr3t-hdr in "1"' }, server)!;
  assert.ok(!line.includes('s3cr3t'));
  assert.ok(line.includes('***') && line.includes('"1"')); // a 1-character value is not masked (see the shortcut in redact)
  assert.equal(redact('no secrets here', server), 'no secrets here');
  assert.equal(redact('s3cr3t-value', undefined), 's3cr3t-value');
});
