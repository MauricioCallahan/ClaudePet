// A tiny stdio MCP server for tests: one tool, echo, that returns its text. Plain Node, no dependencies.
const readline = require('node:readline');
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const TOOL = {
  name: 'echo',
  description: 'Returns the text it is given.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (!m || m.id === undefined || m.id === null) return; // notifications need no reply
  const { id, method, params } = m;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } });
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: [TOOL] } });
  if (method === 'tools/call' && params?.name === 'echo') return send({ id, result: { content: [{ type: 'text', text: String(params.arguments?.text ?? '') }] } });
  send({ id, error: { code: -32601, message: `Unknown method ${String(method)}` } });
});
