// Stands in for the claude CLI in e2e tests: reads the prompt from stdin and prints stream-json lines.
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
  say(resume ? `resumed ${resume}: ` : 'fresh: ');
  say(prompt);
  out({ type: 'result', subtype: 'success', is_error: false, result: prompt, session_id });
});
