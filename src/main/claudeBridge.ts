import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Bridge } from './bridge';
import { isSessionId, type Mode } from './chats';
import { BridgeError, deniedMessage, describe, toBridgeError, type ErrorCase } from './errors';
import type { ToolSettings } from './settings';

// Finds the claude executable: the CLAUDEPET_CLAUDE override, then PATH, then the usual install locations.
export function findClaude(env: NodeJS.ProcessEnv, exists: (file: string) => boolean, home: string): string | undefined {
  if (env.CLAUDEPET_CLAUDE) return exists(env.CLAUDEPET_CLAUDE) ? env.CLAUDEPET_CLAUDE : undefined;
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const candidates = dirs.flatMap((d) => ['claude.exe', 'claude.cmd', 'claude'].map((n) => path.join(d, n)));
  candidates.push(path.join(home, '.local', 'bin', 'claude.exe'));
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', 'claude.cmd'));
  return candidates.find(exists);
}

// Node refuses to start .cmd/.bat files without a shell; the shell then needs the path quoted.
// Safe because no user text is ever passed as an argument (the prompt goes over stdin).
export function command(exe: string): { file: string; shell: boolean } {
  const shell = /\.(cmd|bat)$/i.test(exe);
  return { file: shell ? `"${exe}"` : exe, shell };
}

// Through a shell the args are joined with spaces, so an empty value would vanish and the flag would take the next one.
export function shellArgs(args: string[], shell: boolean): string[] {
  return shell ? args.map((a) => (a === '' ? '""' : a)) : args;
}

export function readVersion(exe: string): Promise<string | undefined> {
  const { file, shell } = command(exe);
  return new Promise((resolve) => {
    execFile(file, ['--version'], { shell, timeout: 5000, windowsHide: true }, (err, stdout) =>
      resolve(err ? undefined : stdout.trim() || undefined),
    );
  });
}

export interface BridgeEvent {
  chunk?: string;
  sessionId?: string;
  error?: string;
  resetsAt?: number; // the usage limit was hit; unix seconds when it resets
  offline?: number; // Claude Code is retrying a request that got no response at all: its attempt number
}

// One line of `claude -p --output-format stream-json`. Anything we do not need, or cannot parse, is null.
export function parseLine(line: string): BridgeEvent | null {
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return null; // a truncated line (killed mid-write) must not end the reply with a parse error
  }
  if (!v || typeof v !== 'object') return null;
  const sessionId = typeof v.session_id === 'string' ? v.session_id : undefined;
  if (v.type === 'system' && v.subtype === 'init') return sessionId ? { sessionId } : null;
  // error_status is null when no HTTP response came back; a status (429, 529) is the API, not the network.
  // attempt restarts for every request, so blips in different requests never add up.
  if (v.type === 'system' && v.subtype === 'api_retry') return v.error_status === null && typeof v.attempt === 'number' ? { offline: v.attempt } : null;
  if (v.type === 'stream_event') {
    const d = v.event?.delta;
    return v.event?.type === 'content_block_delta' && d?.type === 'text_delta' && typeof d.text === 'string' ? { chunk: d.text } : null;
  }
  if (v.type === 'rate_limit_event') {
    const info = v.rate_limit_info;
    return info?.status === 'rejected' && typeof info.resetsAt === 'number' ? { resetsAt: info.resetsAt } : null;
  }
  if (v.type === 'result') {
    // Reported as a success, but a denied tool means the reply is not what was asked for.
    const denied = Array.isArray(v.permission_denials) ? v.permission_denials[0] : undefined;
    if (denied) {
      return { error: deniedMessage(typeof denied.tool_name === 'string' ? denied.tool_name : 'a tool') };
    }
    if (!v.is_error) return sessionId ? { sessionId } : null;
    return { error: typeof v.result === 'string' && v.result ? v.result : 'Claude Code reported an error.' };
  }
  return null;
}

// child.kill() on Windows leaves grandchildren running (a .cmd shim starts node), so kill the whole tree.
// Sync, so it has finished before the app exits on Quit.
function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
}

export interface ClaudeBridgeOptions {
  exe: () => string | undefined;
  cwd: string; // Claude Code keeps sessions per folder, so this must not change between runs
  sessions: { get(chatId: string): string | undefined; set(chatId: string, sessionId: string | undefined): void };
  transcript?: (sessionId: string) => string | undefined; // the session's file in Claude Code, so a failed turn can be taken out
  mode: (chatId: string) => Mode;
  model: () => unknown; // read on every send, so a settings change applies to the next message
  tools: () => ToolSettings; // read on every send, like model
  instructions: () => string | undefined; // the user's own custom instructions file, if any
  promptFile: string; // where chat mode writes the system prompt; must sit outside cwd so cwd stays empty
  idleMs: number; // no output for this long ends the reply as a timeout
}

// Replaces Claude Code's coding prompt in chat mode. Claude Code keeps a chat's first prompt, so edits apply to new chats.
export const PET_PROMPT = [
  "You are ClaudePet, a friendly companion in a small chat box on the user's Windows desktop.",
  'Keep replies short and easy to read in a narrow window: a few sentences or a short list, longer only when asked.',
  'Markdown works (lists, code blocks, links); avoid wide tables and large headings.',
  // True whatever is turned on, since a resumed chat keeps the prompt it started with.
  "Use a tool only when it clearly helps; if you need one that isn't available, say so plainly.",
].join(' ');

export function systemPrompt(custom?: string): string {
  const own = custom?.trim();
  return own ? `${PET_PROMPT}\n\nThe user's own instructions:\n\n${own}` : PET_PROMPT;
}

// Chat mode: only the tools turned on in settings, and none of the user's own settings, hooks, plugins, connectors or skills.
// Not --bare: it never reads the Pro login.
const CHAT_ONLY = ['--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands'];

// The built-in tools a setting can turn on. Only these names ever become arguments.
const WEB_TOOLS: Record<keyof ToolSettings, string> = { webSearch: 'WebSearch', webFetch: 'WebFetch' };

// The model comes from settings.json and becomes an argument through a shell: an alias or id like opus[1m] only.
const MODEL = /^[A-Za-z0-9][\w.\-[\]]*$/;
const DEFAULT_MODEL = 'sonnet';

// promptFile is relative to cwd: an absolute path could hold spaces (a username), which break the shell command line.
export function buildArgs({
  mode = 'chat',
  sessionId,
  model,
  promptFile,
  tools,
}: { mode?: Mode; sessionId?: string; model?: unknown; promptFile?: string; tools?: ToolSettings } = {}): string[] {
  // --verbose is required for stream-json in print mode; partial messages give text as it is written.
  // --permission-prompts none: the process is hidden, so anything that would ask for permission is denied, never left waiting.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none'];
  args.push('--model', typeof model === 'string' && MODEL.test(model) ? model : DEFAULT_MODEL);
  if (mode === 'chat') {
    const on = (Object.keys(WEB_TOOLS) as (keyof ToolSettings)[]).filter((k) => tools?.[k] === true).map((k) => WEB_TOOLS[k]).join(',');
    args.push('--tools', on, ...CHAT_ONLY);
    // The process is hidden and can't ask, so a tool turned on must also be allowed to run.
    if (on) args.push('--allowedTools', on);
  }
  if (mode === 'chat' && promptFile) args.push('--system-prompt-file', promptFile);
  if (isSessionId(sessionId)) args.push('--resume', sessionId);
  return args;
}

// Claude Code writes the user's turn to the transcript as the turn starts, and only appends after that.
// Cuts the file back to what it held before the turn; a file whose start changed is left alone, never corrupted.
export function rewind(file: string, kept: Buffer): void {
  const now = fs.readFileSync(file);
  if (now.length > kept.length && now.subarray(0, kept.length).equals(kept)) fs.truncateSync(file, kept.length);
}

const readOrNone = (file: string | undefined): Buffer | undefined => {
  try {
    return file ? fs.readFileSync(file) : undefined;
  } catch {
    return undefined; // no transcript to take a failed turn out of
  }
};

// Claude Code retries on its own for minutes; a blip recovers within a few retries, so more than that means offline.
const OFFLINE_RETRIES = 3;

// Runs the claude CLI once per message and streams its reply.
export class ClaudeBridge implements Bridge {
  constructor(private opts: ClaudeBridgeOptions) {}

  async *send(chatId: string, text: string, signal: AbortSignal): AsyncGenerator<string> {
    signal.throwIfAborted();
    const exe = this.opts.exe();
    if (!exe) throw new BridgeError(describe('not-installed', 'Claude Code is not installed.'));
    const { file, shell } = command(exe);
    const { cwd, promptFile } = this.opts;
    const mode = this.opts.mode(chatId);
    fs.mkdirSync(cwd, { recursive: true });
    if (mode === 'chat') fs.writeFileSync(promptFile, systemPrompt(this.opts.instructions()));
    const before = this.opts.sessions.get(chatId);
    const kept = before ? readOrNone(this.opts.transcript?.(before)) : undefined;
    const args = shellArgs(
      buildArgs({ mode, sessionId: before, model: this.opts.model(), tools: this.opts.tools(), promptFile: path.relative(cwd, promptFile) }),
      shell,
    );
    const child = spawn(file, args, { cwd, shell, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once('error', (err) => reject(toBridgeError(err.message))); // e.g. the executable vanished since it was found
      child.once('close', resolve);
    });
    exit.catch(() => {}); // awaited below; this only stops an early throw from leaving it unhandled
    child.stdin.on('error', () => {}); // the child may exit before reading its input
    // The prompt goes over stdin, never as an argument, so it cannot be read as a flag or shell syntax.
    child.stdin.end(text);
    const onAbort = () => killTree(child);
    signal.addEventListener('abort', onAbort, { once: true });
    let error: string | undefined;
    let resetsAt: number | undefined;
    let stopped: ErrorCase | undefined; // set when we end the process ourselves
    const stop = (c: ErrorCase) => {
      stopped = c;
      killTree(child);
    };
    const idle = setTimeout(() => stop('timeout'), this.opts.idleMs);
    try {
      for await (const line of readline.createInterface({ input: child.stdout })) {
        if (signal.aborted) break; // lines already buffered must not keep streaming after Stop
        idle.refresh();
        const ev = parseLine(line);
        if (ev?.offline && ev.offline >= OFFLINE_RETRIES) {
          stop('network');
          break;
        }
        if (ev?.error) error = ev.error;
        if (ev?.resetsAt) resetsAt = ev.resetsAt;
        if (ev?.sessionId) this.opts.sessions.set(chatId, ev.sessionId);
        if (ev?.chunk) yield ev.chunk;
      }
      const code = await exit;
      signal.throwIfAborted();
      if (stopped === 'network') throw new BridgeError(describe('network', ''), `no response after ${OFFLINE_RETRIES} retries`);
      if (stopped === 'timeout') throw new BridgeError(describe('timeout', ''), `no output for ${this.opts.idleMs} ms`);
      if (error) throw toBridgeError(error, code, resetsAt);
      if (code !== 0) throw toBridgeError(`claude exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`, code, resetsAt);
    } catch (err) {
      if (err instanceof BridgeError && err.info.retry) this.undoTurn(chatId, before, kept);
      throw err;
    } finally {
      clearTimeout(idle);
      signal.removeEventListener('abort', onAbort);
      killTree(child); // no-op after a normal exit; covers a caller that stops reading early
    }
  }

  // A turn that offers Retry may already be in Claude Code's session: take it out, so Retry sends the prompt only once.
  // Runs after the process has exited, so nothing is still writing the transcript.
  private undoTurn(chatId: string, before: string | undefined, kept: Buffer | undefined): void {
    try {
      const started = this.opts.sessions.get(chatId);
      if (before) {
        const file = this.opts.transcript?.(before);
        if (file && kept) rewind(file, kept);
      } else if (started) {
        // The chat's first turn: Retry starts a new session, and the half-made one is removed.
        this.opts.sessions.set(chatId, undefined);
        const file = this.opts.transcript?.(started);
        if (file) fs.rmSync(file, { force: true });
      }
    } catch (err) {
      console.error('Could not take the failed turn out of the Claude Code session:', err); // Retry then repeats the prompt, nothing worse
    }
  }
}
