import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildArgs, chatTools, ClaudeBridge, command, findClaude, parseLine, PET_PROMPT, rewind, shellArgs, systemPrompt, writeRunConfig } from './claudeBridge';
import { BridgeError } from './errors';

test('buildArgs resumes only with a well-formed session id', () => {
  const id = '730602b1-d89c-41bf-9f2d-54bc04302aef';
  assert.deepEqual(buildArgs({ sessionId: id }).slice(-2), ['--resume', id]);
  for (const bad of [undefined, '', 'abc', `${id} & calc`, '--dangerously-skip-permissions']) assert.ok(!buildArgs({ sessionId: bad }).includes('--resume'));
});
test('buildArgs turns off tools and the user setup in chat mode (the default) only', () => {
  const chat = buildArgs();
  assert.equal(chat[chat.indexOf('--tools') + 1], '');
  assert.equal(chat[chat.indexOf('--setting-sources') + 1], '');
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands']) assert.ok(chat.includes(flag));
  assert.deepEqual(buildArgs({ mode: 'chat' }), chat);
  assert.ok(!buildArgs({ mode: 'code' }).includes('--tools'));
});
test('buildArgs passes only the web tools turned on, and allows them to run', () => {
  const flags = (webSearch: boolean, webFetch: boolean) => {
    const a = buildArgs({ tools: { webSearch, webFetch } });
    return [a[a.indexOf('--tools') + 1], a.includes('--allowedTools') ? a[a.indexOf('--allowedTools') + 1] : undefined];
  };
  assert.deepEqual(flags(false, false), ['', undefined]);
  assert.deepEqual(flags(true, false), ['WebSearch', 'WebSearch']);
  assert.deepEqual(flags(false, true), ['WebFetch', 'WebFetch']);
  assert.deepEqual(flags(true, true), ['WebSearch,WebFetch', 'WebSearch,WebFetch']);
  assert.deepEqual(buildArgs({ tools: { webSearch: false, webFetch: false } }), buildArgs());
});
test('buildArgs leaves tools to the user setup in code mode', () => {
  const code = buildArgs({ mode: 'code', tools: { webSearch: true, webFetch: true } });
  assert.ok(!code.includes('--tools') && !code.includes('--allowedTools'));
});
test('buildArgs passes the model from settings, or sonnet when it is missing or unsafe', () => {
  const model = (m?: unknown) => {
    const a = buildArgs({ model: m });
    return a[a.indexOf('--model') + 1];
  };
  for (const ok of ['opus', 'claude-sonnet-5-5', 'opus[1m]', 'claude-3.5-haiku']) assert.equal(model(ok), ok);
  for (const bad of [undefined, '', 5, 'x & calc', '--dangerously-skip-permissions', 'a b', 'opus"']) assert.equal(model(bad), 'sonnet');
});
test('buildArgs passes the pet prompt file in chat mode only', () => {
  const file = path.join('..', 'system-prompt.md');
  assert.deepEqual(buildArgs({ promptFile: file }).slice(-2), ['--system-prompt-file', file]);
  assert.ok(!buildArgs({ mode: 'code', promptFile: file }).includes('--system-prompt-file'));
});
test('the pet prompt stays true whichever tools are turned on', () => {
  assert.ok(PET_PROMPT.includes("Use a tool only when it clearly helps; if you need one that isn't available, say so plainly."));
  assert.ok(!PET_PROMPT.includes('no tools'));
});
test('systemPrompt adds the custom instructions after the pet prompt, and skips a blank file', () => {
  assert.equal(systemPrompt(), PET_PROMPT);
  assert.equal(systemPrompt('  \n '), PET_PROMPT);
  const p = systemPrompt('  Answer in Spanish.\n');
  assert.ok(p.startsWith(PET_PROMPT) && p.endsWith('\n\nAnswer in Spanish.'));
});
test('shellArgs quotes empty values only when going through a shell', () => {
  assert.deepEqual(shellArgs(['--tools', '', '-p'], true), ['--tools', '""', '-p']);
  assert.deepEqual(shellArgs(['--tools', ''], false), ['--tools', '']);
});

const only = (...files: string[]) => (f: string) => files.includes(f);
const home = path.join('home', 'me');
const local = path.join(home, '.local', 'bin', 'claude.exe');

test('findClaude prefers PATH over the known install locations', () => {
  const onPath = path.join('bin', 'claude.cmd');
  const env = { PATH: ['other', 'bin'].join(path.delimiter) };
  assert.equal(findClaude(env, only(onPath, local), home), onPath);
  assert.equal(findClaude(env, only(local), home), local);
});
test('findClaude checks the npm folder under APPDATA', () => {
  const npm = path.join('appdata', 'npm', 'claude.cmd');
  assert.equal(findClaude({ APPDATA: 'appdata' }, only(npm), home), npm);
});
test('findClaude returns undefined when nothing is installed', () => {
  assert.equal(findClaude({ PATH: 'bin' }, () => false, home), undefined);
  assert.equal(findClaude({}, () => false, home), undefined);
});
test('findClaude uses the override and does not fall back when it is missing', () => {
  const env = { CLAUDEPET_CLAUDE: 'fake.cmd', PATH: 'bin' };
  assert.equal(findClaude(env, only('fake.cmd'), home), 'fake.cmd');
  assert.equal(findClaude(env, only(path.join('bin', 'claude.exe')), home), undefined);
});
test('command quotes .cmd files and runs them through a shell', () => {
  assert.deepEqual(command('C:\\a b\\claude.cmd'), { file: '"C:\\a b\\claude.cmd"', shell: true });
  assert.deepEqual(command('C:\\a b\\claude.exe'), { file: 'C:\\a b\\claude.exe', shell: false });
});

const init = '{"type":"system","subtype":"init","cwd":"C:\\\\x","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef","tools":[]}';
const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
const result = '{"type":"result","subtype":"success","is_error":false,"result":"hi there","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}';

test('parseLine reads the session id, text deltas and the final result', () => {
  assert.deepEqual(parseLine(init), { sessionId: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
  assert.deepEqual(parseLine(delta('hi there')), { chunk: 'hi there' });
  assert.deepEqual(parseLine(result), { sessionId: '730602b1-d89c-41bf-9f2d-54bc04302aef' });
});

test('parseLine: a multi-chunk reply joins to the full text', () => {
  const lines = [init, delta('Hello'), delta(', wor'), delta('ld!\n'), result];
  const text = lines.map((l) => parseLine(l)?.chunk ?? '').join('');
  assert.equal(text, 'Hello, world!\n');
});
test('parseLine: an error result carries the message and no session id', () => {
  const line = '{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}';
  assert.deepEqual(parseLine(line), { error: 'Invalid API key · Please run /login' });
  assert.deepEqual(parseLine('{"type":"result","subtype":"error_during_execution","is_error":true}'), { error: 'Claude Code reported an error.' });
});
test('parseLine: a result lists every denied tool with its id, even though it says success', () => {
  // Recorded from claude 2.1.321 with --permission-prompts none (usage and other fields trimmed).
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'The command was blocked.', session_id: '6c0baf1c-cc0a-4f43-8d71-1194d5c4a136', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_01', tool_input: { command: 'echo hi > x.txt' } }] });
  assert.deepEqual(parseLine(line), { denied: [{ toolName: 'Bash', id: 'toolu_01' }] });
  const odd = JSON.stringify({ type: 'result', is_error: false, permission_denials: [{ tool_name: 'WebFetch', tool_use_id: 'a' }, { tool_name: 5 }, null] });
  assert.deepEqual(parseLine(odd), { denied: [{ toolName: 'WebFetch', id: 'a' }, { toolName: 'a tool' }] });
  assert.deepEqual(parseLine(JSON.stringify({ type: 'result', is_error: false, permission_denials: [], session_id: 's' })), { sessionId: 's' });
});
test('parseLine: a failed turn that also lists denials keeps its error', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 500', permission_denials: [{ tool_name: 'WebFetch', tool_use_id: 'a' }] });
  assert.deepEqual(parseLine(line), { denied: [{ toolName: 'WebFetch', id: 'a' }], error: 'API Error: 500' });
});
test('buildArgs never lets a permission prompt wait for an answer without the approval tool, in any mode', () => {
  for (const mode of ['chat', 'code'] as const) assert.equal(buildArgs({ mode }).join(' ').includes('--permission-prompts none'), true);
  assert.equal(buildArgs({ mode: 'code', approvals: 'x.json' }).join(' ').includes('--permission-prompts none'), true); // code mode keeps the user's setup
});
test('buildArgs with approvals asks through the approval tool instead of denying', () => {
  const file = path.join('..', 'mcp-run.json');
  const a = buildArgs({ approvals: file });
  assert.ok(!a.includes('--permission-prompts'));
  assert.equal(a[a.indexOf('--mcp-config') + 1], file);
  assert.equal(a[a.indexOf('--permission-prompt-tool') + 1], 'mcp__claudepet__approve');
  assert.ok(a.includes('--strict-mcp-config')); // still nothing from the user's own MCP setup
  assert.ok(!buildArgs({ mode: 'code', approvals: file }).includes('--mcp-config'));
  assert.ok(!buildArgs().includes('--mcp-config') && !buildArgs().includes('--permission-prompt-tool'));
});
test('a web tool with an ask or deny rule is offered but not allowed, so it goes to the approval tool', () => {
  const both = { webSearch: true, webFetch: true };
  assert.deepEqual(chatTools(both), { on: ['WebSearch', 'WebFetch'], allowed: ['WebSearch', 'WebFetch'] });
  assert.deepEqual(chatTools(both, { WebFetch: 'ask' }), { on: ['WebSearch', 'WebFetch'], allowed: ['WebSearch'] });
  assert.deepEqual(chatTools(both, { WebSearch: 'deny', WebFetch: 'ask' }).allowed, []);
  const a = buildArgs({ tools: both, rules: { WebFetch: 'ask' }, approvals: 'r.json' });
  assert.equal(a[a.indexOf('--tools') + 1], 'WebSearch,WebFetch');
  assert.equal(a[a.indexOf('--allowedTools') + 1], 'WebSearch');
  assert.ok(!buildArgs({ tools: both, rules: { WebSearch: 'ask', WebFetch: 'ask' } }).includes('--allowedTools'));
});
test('writeRunConfig holds only the approval server, in Node mode, with its env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-run-'));
  try {
    const f = path.join(dir, 'mcp-run.json');
    writeRunConfig(f, { command: 'C:\Program Files\ClaudePet\ClaudePet.exe', args: ['server.js'] }, { CLAUDEPET_PIPE: 'p', CLAUDEPET_TOKEN: 't' });
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), {
      mcpServers: { claudepet: { type: 'stdio', command: 'C:\Program Files\ClaudePet\ClaudePet.exe', args: ['server.js'], env: { ELECTRON_RUN_AS_NODE: '1', CLAUDEPET_PIPE: 'p', CLAUDEPET_TOKEN: 't' } } },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('parseLine: truncated or non-JSON lines are ignored, not thrown', () => {
  for (const line of [delta('cut off').slice(0, 60), '', 'Warning: something on stdout', 'null', '5', '"text"']) assert.equal(parseLine(line), null);
});
test('parseLine: lines that are not reply text are ignored', () => {
  const lines = [
    '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"system","subtype":"status","status":"requesting","session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}}',
    '{"type":"stream_event","event":{"type":"message_stop"}}',
    // The whole message again: counting it would show every reply twice.
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]},"session_id":"730602b1-d89c-41bf-9f2d-54bc04302aef"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  ];
  for (const line of lines) assert.equal(parseLine(line), null);
});
// Recorded from claude 2.1.331 with the chat flags and --tools WebSearch, and an MCP echo server (ids, usage and other fields trimmed).
const S = '25f54293-6c62-4661-81b7-f24a0f117da0';
const searchStart = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_01Y6', name: 'WebSearch', input: {}, caller: { type: 'direct' } } }, session_id: S });
const searchCall = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01Y6', name: 'WebSearch', input: { query: 'Austin Texas current population 2026', mode: 'standard' }, caller: { type: 'direct' } }] }, parent_tool_use_id: null, session_id: S });
const searchResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_01Y6', type: 'tool_result', content: 'Web search results for query: "Austin Texas current population 2026"…' }] }, parent_tool_use_id: null, session_id: S });
const mcpCall = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01KF', name: 'mcp__echo__echo_text', input: { text: 'hello' } }] }, session_id: S });
const mcpError = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'echo is broken', is_error: true, tool_use_id: 'toolu_01Vb' }] }, session_id: S });

test('parseLine: a tool start shows at once, with its input still empty', () => {
  assert.deepEqual(parseLine(searchStart), { tools: [{ id: 'toolu_01Y6', name: 'WebSearch', input: {} }] });
});
test('parseLine: the assistant message gives the full tool input', () => {
  assert.deepEqual(parseLine(searchCall), { tools: [{ id: 'toolu_01Y6', name: 'WebSearch', input: { query: 'Austin Texas current population 2026', mode: 'standard' } }] });
  assert.deepEqual(parseLine(mcpCall), { tools: [{ id: 'toolu_01KF', name: 'mcp__echo__echo_text', input: { text: 'hello' } }] });
});
test('parseLine: a tool result ends the tool, as an error only when is_error is true', () => {
  assert.deepEqual(parseLine(searchResult), { done: [{ id: 'toolu_01Y6', isError: false }] });
  assert.deepEqual(parseLine(mcpError), { done: [{ id: 'toolu_01Vb', isError: true }] });
});
test('parseLine: text and a tool in one message give only the tool, since the text was streamed', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } }] } });
  assert.deepEqual(parseLine(line), { tools: [{ id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } }] });
});
test('parseLine: two tools or two results in one message all come back', () => {
  const two = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'WebSearch', input: { query: 'x' } }, { type: 'tool_use', id: 'b', name: 'WebFetch', input: {} }] } });
  assert.deepEqual(parseLine(two)?.tools?.map((t) => t.id), ['a', 'b']);
  const done = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a' }, { type: 'tool_result', tool_use_id: 'b', is_error: true }] } });
  assert.deepEqual(parseLine(done), { done: [{ id: 'a', isError: false }, { id: 'b', isError: true }] });
});
test('parseLine: tool blocks without a string id or name, and other user or assistant shapes, are skipped', () => {
  const lines = [
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 5, name: 'WebSearch' } } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a' }, null, 'x'] } }),
    JSON.stringify({ type: 'assistant', message: { content: 'just text' } }),
    JSON.stringify({ type: 'assistant' }),
    JSON.stringify({ type: 'user', message: { content: 'the prompt' } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: null }, { type: 'text', text: 'x' }] } }),
  ];
  for (const line of lines) assert.equal(parseLine(line), null);
  assert.deepEqual(parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'X' }] } })), { tools: [{ id: 'a', name: 'X', input: {} }] });
});
test('parseLine: a rejected rate_limit_event gives the reset time; an allowed one is ignored', () => {
  // Shape from claude 2.1.321 (other rate_limit_info fields trimmed).
  const line = (status: string) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt: 1736985600, rateLimitType: 'five_hour' }, session_id: 's' });
  assert.deepEqual(parseLine(line('rejected')), { resetsAt: 1736985600 });
  assert.equal(parseLine(line('allowed')), null);
  assert.equal(parseLine('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}'), null);
});
test('parseLine: an api_retry with no response means offline; one with a status is the API, not the network', () => {
  // Shape from claude 2.1.321.
  const retry = (error_status: number | null, attempt = 1) => JSON.stringify({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 500, error_status, error: 'unknown', session_id: 's' });
  assert.deepEqual(parseLine(retry(null)), { offline: 1 });
  assert.deepEqual(parseLine(retry(null, 3)), { offline: 3 }); // the attempt of this request, not a running total
  assert.equal(parseLine(retry(529)), null);
});

test('rewind cuts a transcript back to its old bytes, and leaves one whose start changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-rewind-'));
  try {
    const f = path.join(dir, 's.jsonl');
    fs.writeFileSync(f, 'a\nb\nfailed turn\n');
    rewind(f, Buffer.from('a\nb\n'));
    assert.equal(fs.readFileSync(f, 'utf8'), 'a\nb\n');
    fs.writeFileSync(f, 'rewritten\nfailed turn\n');
    rewind(f, Buffer.from('a\nb\n'));
    assert.equal(fs.readFileSync(f, 'utf8'), 'rewritten\nfailed turn\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Drives the real bridge with the e2e fake claude, which writes the user's turn to FAKE_TRANSCRIPT as it starts.
test('a turn that ends with Retry offered is taken out of the session, so Retry sends the prompt once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-undo-'));
  const transcript = path.join(dir, 's.jsonl');
  const offline = path.join(dir, 'offline');
  fs.writeFileSync(offline, '');
  Object.assign(process.env, { FAKE_TRANSCRIPT: transcript, FAKE_OFFLINE_FILE: offline });
  let session: string | undefined;
  const sets: (string | undefined)[] = [];
  const bridge = new ClaudeBridge({
    exe: () => path.resolve('e2e/fixtures/fake-claude.cmd'),
    cwd: path.join(dir, 'workspace'),
    sessions: { get: () => session, set: (_id, s) => (sets.push(s), (session = s)) },
    transcript: () => transcript,
    mode: () => 'chat',
    model: () => undefined,
    tools: () => ({ webSearch: false, webFetch: false }),
    instructions: () => undefined,
    promptFile: path.join(dir, 'prompt.md'),
    idleMs: 30_000,
  });
  const run = async (text: string) => {
    try {
      for await (const _ of bridge.send('c', text, new AbortController().signal));
    } catch (err) {
      return err as BridgeError;
    }
  };
  try {
    // The first turn: the half-made session is dropped and its transcript removed.
    assert.equal((await run('/offline'))?.info.case, 'network');
    assert.equal(session, undefined);
    assert.ok(sets.includes('11111111-2222-4333-8444-555555555555'));
    assert.equal(fs.existsSync(transcript), false);

    // A later turn: the transcript goes back to what it held before.
    session = '11111111-2222-4333-8444-555555555555';
    fs.writeFileSync(transcript, '{"type":"user","prompt":"hi"}\n');
    assert.equal((await run('/offline'))?.info.case, 'network');
    assert.equal(fs.readFileSync(transcript, 'utf8'), '{"type":"user","prompt":"hi"}\n');
    assert.equal(session, '11111111-2222-4333-8444-555555555555');

    // An error without Retry keeps the turn.
    assert.equal((await run('/signedout'))?.info.case, 'not-signed-in');
    assert.match(fs.readFileSync(transcript, 'utf8'), /signedout/);
  } finally {
    delete process.env.FAKE_TRANSCRIPT;
    delete process.env.FAKE_OFFLINE_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The fake claude's "/approve" asks through the approval server from mcp-run.json, like claude does.
test('a tool the user denied reaches Claude and the reply ends normally; with no approval tool it is an error', async () => {
  const { ApprovalPipe, Approvals, DENIED } = await import('./approvals');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-approve-'));
  const pipe = new ApprovalPipe();
  await pipe.listen();
  const approvals = new Approvals(pipe, { command: process.execPath, args: [path.resolve('dist/approval/server.js')] }, (card) => card && approvals.answer(card.id, 'deny'), { rules: () => ({ WebFetch: 'ask' }) });
  const bridge = (withApprovals: boolean) =>
    new ClaudeBridge({
      exe: () => path.resolve('e2e/fixtures/fake-claude.cmd'),
      cwd: path.join(dir, 'workspace'),
      sessions: { get: () => undefined, set: () => {} },
      mode: () => 'chat',
      model: () => undefined,
      tools: () => ({ webSearch: true, webFetch: true }),
      rules: () => ({ WebFetch: 'ask' }),
      ...(withApprovals ? { approvals, runConfigFile: path.join(dir, 'mcp-run.json') } : {}),
      instructions: () => undefined,
      promptFile: path.join(dir, 'prompt.md'),
      idleMs: 30_000,
    });
  const run = async (b: ClaudeBridge) => {
    let text = '';
    for await (const ev of b.send('c', '/approve WebFetch', new AbortController().signal)) if (typeof ev === 'string') text += ev;
    return text;
  };
  try {
    assert.equal(await run(bridge(true)), `WebFetch: denied (${DENIED})`);
    await assert.rejects(run(bridge(false)), /Web fetch is off/);
  } finally {
    pipe.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
