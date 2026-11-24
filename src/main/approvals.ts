// Main's end of the approval channel. Electron-free, so node --test can load it.
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { toVerdict, type Verdict } from '../approval/decide';

export interface ApprovalRequest {
  toolName: string;
  input: unknown;
  toolUseId?: string;
}
type Handler = (req: ApprovalRequest) => Promise<Verdict>;

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
