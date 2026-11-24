// Stands in for the claude CLI in e2e tests: reads the prompt from stdin and prints stream-json lines.
const fs = require('node:fs');
const args = process.argv.slice(2);
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined;
const session_id = resume ?? '11111111-2222-4333-8444-555555555555';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id });

let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  // Like claude, the init line lists every server in --mcp-config, the approval server included; "missing-command" fails to start.
  const mcpFile = args.includes('--mcp-config') ? args[args.indexOf('--mcp-config') + 1] : undefined;
  const mcp_servers = mcpFile
    ? Object.entries(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers).map(([name, s]) => ({ name, status: s.command === 'missing-command' ? 'failed' : 'connected', source: 'dynamic' }))
    : [];
  out({ type: 'system', subtype: 'init', session_id, mcp_servers });
  // Like claude, the user's turn reaches the session transcript as the turn starts.
  if (process.env.FAKE_TRANSCRIPT) fs.appendFileSync(process.env.FAKE_TRANSCRIPT, JSON.stringify({ type: 'user', prompt }) + '\n');
  if (prompt.startsWith('/hang')) {
    say(`pid=${process.pid};`);
    setInterval(() => {}, 1000); // never finishes: only Stop or Quit ends it
    return;
  }
  if (prompt.startsWith('/args')) {
    // In a code block so Markdown leaves the backslashes alone; lets a spec check exactly how the bridge started us.
    say('```\n' + JSON.stringify({ args, cwd: process.cwd() }) + '\n```');
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id });
    return;
  }
  // A web search in the shapes claude 2.1.331 prints, slow enough to see each pet state. "/tool fail" fails it.
  if (prompt.startsWith('/tool')) {
    const id = 'toolu_fake';
    const input = { query: 'weather in Austin', mode: 'standard' };
    const wait = () => new Promise((r) => setTimeout(r, 800));
    (async () => {
      await wait(); // thinking
      out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'WebSearch', input: {} } }, session_id });
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'WebSearch', input }] }, session_id });
      await wait(); // the search runs
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'results', ...(prompt.includes('fail') ? { is_error: true } : {}) }] }, session_id });
      await wait(); // Claude reads the results
      say('Sunny, 72°F.');
      out({ type: 'result', subtype: 'success', is_error: false, result: 'Sunny, 72°F.', session_id });
    })();
    return;
  }
  // "/approve WebFetch [Bash]": Claude calls these tools at once, asking through the approval server from --mcp-config the
  // way claude does (MCP over stdio). Without it, like --permission-prompts none, each call is denied unanswered.
  if (prompt.startsWith('/approve')) {
    const names = prompt.split(/\s+/).slice(1).filter(Boolean);
    const tools = (names.length ? names : ['WebFetch']).map((name, i) => ({ id: `toolu_ap${i}`, name, input: name === 'WebFetch' ? { url: 'https://example.com', prompt: 'x' } : { command: 'dir' } }));
    for (const t of tools) out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } }, session_id });
    out({ type: 'assistant', message: { role: 'assistant', content: tools.map((t) => ({ type: 'tool_use', ...t })) }, session_id });
    const config = args.includes('--mcp-config') ? JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.claudepet : undefined;
    const finish = (answers) => {
      const denials = [];
      tools.forEach((t, i) => {
        const a = answers[i];
        if (a.behavior !== 'allow') denials.push({ tool_name: t.name, tool_use_id: t.id, tool_input: t.input });
        out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: t.id, content: a.behavior === 'allow' ? 'ok' : a.message, ...(a.behavior === 'allow' ? {} : { is_error: true }) }] }, session_id });
      });
      const text = answers.map((a, i) => `${tools[i].name}: ${a.behavior === 'allow' ? 'ran' : `denied (${a.message})`}`).join('; ');
      say(text);
      out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id, permission_denials: denials });
    };
    if (!config) {
      finish(tools.map(() => ({ behavior: 'deny', message: 'denied' })));
      return;
    }
    const { spawn } = require('node:child_process');
    const server = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const waiting = new Map();
    let next = 1;
    require('node:readline').createInterface({ input: server.stdout }).on('line', (l) => {
      const m = JSON.parse(l);
      waiting.get(m.id)?.(m);
    });
    const call = (method, params) => new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    (async () => {
      await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } });
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const answers = await Promise.all(
        tools.map(async (t) => JSON.parse((await call('tools/call', { name: 'approve', arguments: { tool_name: t.name, input: t.input, tool_use_id: t.id } })).result.content[0].text)),
      );
      server.stdin.end();
      finish(answers);
    })();
    return;
  }
  if (prompt.startsWith('/deny')) {
    const tool = prompt.split(/\s+/)[1] || 'Bash'; // "/deny WebFetch" denies that tool
    say('I need to use a tool.');
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id, permission_denials: [{ tool_name: tool }] });
    return;
  }
  // Error output in the shapes claude 2.1.321 prints; a real error run exits with 1.
  const fail = (result) => {
    out({ type: 'result', subtype: 'success', is_error: true, result, session_id });
    process.exitCode = 1;
  };
  if (prompt.startsWith('/signedout')) return fail('Not logged in · Please run /login');
  if (prompt.startsWith('/limit')) {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' }, session_id });
    return fail("You've hit your limit · resets 5pm");
  }
  // Offline while the FAKE_OFFLINE_FILE exists: retries that get no response, forever, like claude without network.
  if (prompt.startsWith('/offline') && process.env.FAKE_OFFLINE_FILE && fs.existsSync(process.env.FAKE_OFFLINE_FILE)) {
    say('partial '); // cut off mid-reply, the case where Retry once stored the message twice
    for (let attempt = 1; attempt <= 3; attempt++) out({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 500, error_status: null, error: 'unknown', session_id });
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt.startsWith('/fail')) {
    process.stderr.write('fake claude failed\n');
    process.exit(1);
  }
  say(resume ? `resumed ${resume}: ` : 'fresh: ');
  say(prompt);
  out({ type: 'result', subtype: 'success', is_error: false, result: prompt, session_id });
});
