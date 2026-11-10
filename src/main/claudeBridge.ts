import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Bridge } from './bridge';
import type { Mode } from './chats';

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
  if (v.type === 'stream_event') {
    const d = v.event?.delta;
    return v.event?.type === 'content_block_delta' && d?.type === 'text_delta' && typeof d.text === 'string' ? { chunk: d.text } : null;
  }
  if (v.type === 'result') {
    // Reported as a success, but a denied tool means the reply is not what was asked for.
    const denied = Array.isArray(v.permission_denials) ? v.permission_denials[0] : undefined;
    if (denied) {
      const tool = typeof denied.tool_name === 'string' ? denied.tool_name : 'a tool';
      return { error: `Claude Code asked to use ${tool}, but tools are off in pet chats.` };
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
  sessions: { get(chatId: string): string | undefined; set(chatId: string, sessionId: string): void };
  mode: (chatId: string) => Mode;
}

// The session id becomes a command-line argument, so only a plain UUID is ever passed on.
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Chat mode: no tools, and none of the user's own settings, hooks, plugins, connectors or skills.
// Not --bare: it never reads the Pro login.
const CHAT_ONLY = ['--tools', '', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands'];

export function buildArgs({ mode = 'chat', sessionId }: { mode?: Mode; sessionId?: string } = {}): string[] {
  // --verbose is required for stream-json in print mode; partial messages give text as it is written.
  // --permission-prompts none: the process is hidden, so anything that would ask for permission is denied, never left waiting.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none'];
  if (mode === 'chat') args.push(...CHAT_ONLY);
  if (sessionId && UUID.test(sessionId)) args.push('--resume', sessionId);
  return args;
}

// Runs the claude CLI once per message and streams its reply.
export class ClaudeBridge implements Bridge {
  constructor(private opts: ClaudeBridgeOptions) {}

  async *send(chatId: string, text: string, signal: AbortSignal): AsyncGenerator<string> {
    signal.throwIfAborted();
    const exe = this.opts.exe();
    if (!exe) throw new Error('Claude Code is not installed.');
    const { file, shell } = command(exe);
    const args = shellArgs(buildArgs({ mode: this.opts.mode(chatId), sessionId: this.opts.sessions.get(chatId) }), shell);
    fs.mkdirSync(this.opts.cwd, { recursive: true });
    const child = spawn(file, args, { cwd: this.opts.cwd, shell, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); // e.g. the executable vanished since it was found
      child.once('close', resolve);
    });
    exit.catch(() => {}); // awaited below; this only stops an early throw from leaving it unhandled
    child.stdin.on('error', () => {}); // the child may exit before reading its input
    // The prompt goes over stdin, never as an argument, so it cannot be read as a flag or shell syntax.
    child.stdin.end(text);
    const onAbort = () => killTree(child);
    signal.addEventListener('abort', onAbort, { once: true });
    let error: string | undefined;
    try {
      for await (const line of readline.createInterface({ input: child.stdout })) {
        if (signal.aborted) break; // lines already buffered must not keep streaming after Stop
        const ev = parseLine(line);
        if (ev?.error) error = ev.error;
        if (ev?.sessionId) this.opts.sessions.set(chatId, ev.sessionId);
        if (ev?.chunk) yield ev.chunk;
      }
      const code = await exit;
      signal.throwIfAborted();
      if (error) throw new Error(error);
      if (code !== 0) throw new Error(`claude exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    } finally {
      signal.removeEventListener('abort', onAbort);
      killTree(child); // no-op after a normal exit; covers a caller that stops reading early
    }
  }
}
