import { setTimeout as sleep } from 'node:timers/promises';

export interface ToolUse {
  id: string;
  name: string;
  input: unknown; // {} at the start; the full input comes later under the same id
}
export interface ToolDone {
  id: string;
  isError: boolean;
}
// A tool started (or its input arrived), or it finished.
export type ToolEvent = { tool: ToolUse } | { toolDone: ToolDone };

// What the app needs from a reply source. Milestone 2's real bridge (the claude CLI) implements this too.
export interface Bridge {
  // Yields reply text as it streams in, and tool activity between it; aborting the signal ends the stream by throwing.
  send(chatId: string, text: string, signal: AbortSignal): AsyncIterable<string | ToolEvent>;
}

export interface FakeBridgeOptions {
  waitMs?: () => number; // initial "thinking" delay
  wordMs?: number; // gap between streamed words
}

// "/md" replies with this, to try Markdown rendering (including a script that must not run).
const MD_SAMPLE = [
  '# Heading',
  '',
  'Some **bold** text and a [link](https://example.com).',
  '',
  '- first item',
  '- second item',
  '',
  '```js',
  'const a = 1 < 2;',
  '```',
  '',
  '<script>document.title = "pwned"</script>',
].join('\n');

// Stand-in until Milestone 2: waits 1–3 s, then echoes the message word by word.
export class FakeBridge implements Bridge {
  private waitMs: () => number;
  private wordMs: number;

  constructor({ waitMs = () => 1000 + Math.random() * 2000, wordMs = 50 }: FakeBridgeOptions = {}) {
    this.waitMs = waitMs;
    this.wordMs = wordMs;
  }

  async *send(_chatId: string, text: string, signal: AbortSignal): AsyncGenerator<string | ToolEvent> {
    await sleep(this.waitMs(), undefined, { signal });
    // "/fail" exercises the error path without needing a real failure.
    if (text.startsWith('/fail')) throw new Error('Fake bridge failure (message started with /fail).');
    // "/tool <query>" runs a pretend web search first, to try the activity line without the CLI.
    if (text.startsWith('/tool')) {
      yield { tool: { id: 'fake-tool', name: 'WebSearch', input: {} } };
      yield { tool: { id: 'fake-tool', name: 'WebSearch', input: { query: text.slice(5).trim() || 'something' } } };
      await sleep(this.wordMs * 10, undefined, { signal });
      yield { toolDone: { id: 'fake-tool', isError: false } };
    }
    // "/long" streams a long reply so scrolling can be tried without a real answer.
    const reply = text.startsWith('/md') ? MD_SAMPLE : text.startsWith('/long') ? Array.from({ length: 150 }, (_, i) => `word${i + 1}${i % 12 === 11 ? '\n' : ' '}`).join('') : text;
    for (const word of reply.match(/\S+\s*/g) ?? []) {
      yield word;
      await sleep(this.wordMs, undefined, { signal });
    }
  }
}
