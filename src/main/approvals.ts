// Main's end of the approval channel. Electron-free, so node --test can load it.
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { toVerdict, type Verdict } from '../approval/decide';
import type { Rule, Rules } from './settings';

// The read-only web tools run without a card unless a rule says otherwise; everything else asks.
const ALLOWED_BY_DEFAULT = new Set(['WebSearch', 'WebFetch']);

// A rule for the exact tool wins, then one for its whole MCP server (mcp__<server>__<tool> → mcp__<server>).
export function ruleFor(name: string, rules: Rules): Rule {
  if (Object.hasOwn(rules, name)) return rules[name];
  const server = /^(mcp__.+?)__./.exec(name)?.[1];
  if (server && Object.hasOwn(rules, server)) return rules[server];
  return ALLOWED_BY_DEFAULT.has(name) ? 'allow' : 'ask';
}

export interface ApprovalRequest {
  toolName: string;
  input: unknown;
  toolUseId?: string;
}
type Handler = (req: ApprovalRequest) => Promise<Verdict>;

// One reply's view of the channel: the env for the approval server, the tool calls that got an answer, and end().
export interface ApprovalSession {
  env: Record<string, string>;
  answered: Set<string>; // tool_use ids; a denial among these was the user's (or a rule's), not a tool that is off
  end(): void;
}
export interface ApprovalHost {
  server: { command: string; args: string[] }; // how Claude Code starts the approval server
  begin(chatId: string): ApprovalSession;
}

export class Approvals implements ApprovalHost {
  constructor(
    private pipe: ApprovalPipe,
    readonly server: { command: string; args: string[] },
    private ask: (chatId: string, req: ApprovalRequest) => Promise<Verdict>,
  ) {}

  begin(chatId: string): ApprovalSession {
    const answered = new Set<string>();
    const token = this.pipe.open(async (req) => {
      const v = await this.ask(chatId, req);
      if (req.toolUseId) answered.add(req.toolUseId);
      return v;
    });
    return { env: { CLAUDEPET_PIPE: this.pipe.name, CLAUDEPET_TOKEN: token }, answered, end: () => this.pipe.close(token) };
  }
}

const MAX_LINE = 1_000_000; // a request carries one tool's input; more than this is refused, not buffered
const REFUSED: Verdict = { allow: false, message: 'Not a ClaudePet approval request.' };

// One pipe for the app's life; each reply gets its own token, valid only while that reply runs.
// Any local process can connect to the pipe, so a request without a live token is denied.
export class ApprovalPipe {
  readonly name =
    process.platform === 'win32' ? `\\\\.\\pipe\\claudepet-${crypto.randomBytes(8).toString('hex')}` : path.join(os.tmpdir(), `claudepet-${crypto.randomBytes(8).toString('hex')}.sock`);
  private handlers = new Map<string, Handler>();
  private server = net.createServer((socket) => this.serve(socket));

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.name, () => resolve());
    });
  }

  // A new token for one reply; requests carrying it go to handler until close(token).
  open(handler: Handler): string {
    const token = crypto.randomBytes(24).toString('hex');
    this.handlers.set(token, handler);
    return token;
  }

  close(token: string): void {
    this.handlers.delete(token);
  }

  dispose(): void {
    this.handlers.clear();
    this.server.close();
  }

  private serve(socket: net.Socket): void {
    let buf = '';
    const reply = (v: Verdict) => socket.end(JSON.stringify(v) + '\n');
    socket.setEncoding('utf8');
    socket.on('error', () => {}); // the server gave up (Claude Code killed): nothing to answer
    socket.on('data', (d: string) => {
      if (buf.includes('\n')) return; // one request per connection
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) {
        if (buf.length > MAX_LINE) reply(REFUSED);
        return;
      }
      let m: any;
      try {
        m = JSON.parse(buf.slice(0, nl));
      } catch {
        return reply(REFUSED);
      }
      const handler = typeof m?.token === 'string' ? this.handlers.get(m.token) : undefined;
      if (!handler || typeof m.tool_name !== 'string') return reply(REFUSED);
      const req: ApprovalRequest = { toolName: m.tool_name, input: m.input ?? {}, toolUseId: typeof m.tool_use_id === 'string' ? m.tool_use_id : undefined };
      handler(req).then(
        (v) => reply(toVerdict(v)),
        () => reply({ allow: false, message: 'ClaudePet could not ask about this tool.' }),
      );
    });
  }
}
