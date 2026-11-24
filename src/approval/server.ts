// The approval MCP server. Claude Code starts it from mcp-run.json (as ClaudePet.exe with ELECTRON_RUN_AS_NODE=1) and calls
// its one tool, approve, before any tool that needs asking. Each call goes to ClaudePet's main process over a named pipe,
// with the one-time token from the env, and waits for the answer. Node-only: no Electron, no dependencies.
import net from 'node:net';
import readline from 'node:readline';
import { decide, NO_ANSWER, toVerdict, type Verdict } from './decide';

const PIPE = process.env.CLAUDEPET_PIPE ?? '';
const TOKEN = process.env.CLAUDEPET_TOKEN ?? '';
const MAX_LINE = 1_000_000; // an answer line is tiny; anything bigger is not ClaudePet

const TOOL = {
  name: 'approve',
  description: 'Asks the ClaudePet user to allow or deny a tool call.',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

// One connection per request; a pipe that is gone, closes early or sends junk is a deny.
function ask(args: { tool_name?: unknown; input?: unknown; tool_use_id?: unknown }): Promise<Verdict> {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = (v: Verdict) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    const socket = net.connect(PIPE, () => socket.write(JSON.stringify({ token: TOKEN, tool_name: args.tool_name, input: args.input, tool_use_id: args.tool_use_id }) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        try {
          finish(toVerdict(JSON.parse(buf.slice(0, nl))));
        } catch {
          finish({ allow: false, message: NO_ANSWER });
        }
      } else if (buf.length > MAX_LINE) finish({ allow: false, message: NO_ANSWER });
    });
    socket.on('error', () => finish({ allow: false, message: NO_ANSWER }));
    socket.on('close', () => finish({ allow: false, message: NO_ANSWER }));
  });
}

const send = (msg: object): void => void process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

// MCP over stdio: one JSON-RPC message per line. Only what Claude Code needs from a tool server.
async function handle(m: any): Promise<void> {
  if (!m || typeof m !== 'object' || m.id === undefined || m.id === null) return; // notifications need no reply
  const { id, method, params } = m;
  if (method === 'initialize') {
    const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18';
    return send({ id, result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'claudepet', version: '1' } } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: [TOOL] } });
  if (method === 'tools/call' && params?.name === 'approve') {
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    return send({ id, result: decide(await ask(args), args.input) });
  }
  send({ id, error: { code: -32601, message: `Unknown method ${String(method)}` } });
}

// Claude Code closes stdin when it is done with the server; readline then ends and the process exits.
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m: unknown;
  try {
    m = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  void handle(m);
});
