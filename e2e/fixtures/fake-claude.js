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
  out({ type: 'system', subtype: 'init', session_id });
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
  if (prompt.startsWith('/deny')) {
    say('I need to run a command.');
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id, permission_denials: [{ tool_name: 'Bash' }] });
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
