// mcp.json: the user's own MCP servers, in the shape of Claude Code's .mcp.json. Electron-free, so node --test can load it.
// An entry is passed to Claude Code as written (unknown fields included); only what could break the run config is checked.
export type McpServer = Record<string, unknown>;
export type McpConfig = { servers: Record<string, McpServer> } | { error: string };

// The name becomes part of a tool name (mcp__<name>__<tool>) and of an --allowedTools argument through a shell:
// no "__" (it separates the parts) and no trailing "_", and "claudepet" is the approval server's own.
const NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9-])?$/;
export const RESERVED = 'claudepet';

// What Claude Code reports about one server on the init line of a run: connected, failed, needs-auth, or invalid
// (listed in mcp_server_errors with a message). The init line gives no reason for a failed server, only its status.
export interface McpStatus {
  name: string;
  status: string;
  error?: string;
}

// mcp_servers and mcp_server_errors from an init line; undefined when it has neither (an older or odd shape).
// The approval server is ClaudePet's own and is left out.
export function parseMcpStatus(init: any): McpStatus[] | undefined {
  const servers = init?.mcp_servers;
  const errors = init?.mcp_server_errors;
  if (!Array.isArray(servers) && !Array.isArray(errors)) return undefined;
  const list = new Map<string, McpStatus>();
  for (const s of Array.isArray(servers) ? servers : []) if (typeof s?.name === 'string' && typeof s.status === 'string') list.set(s.name, { name: s.name, status: s.status });
  for (const e of Array.isArray(errors) ? errors : []) {
    if (typeof e?.name !== 'string') continue;
    const error = typeof e.message === 'string' ? e.message : 'invalid config';
    list.set(e.name, { name: e.name, status: list.get(e.name)?.status ?? 'invalid', error });
  }
  list.delete(RESERVED);
  return [...list.values()];
}

// shortcut: values under 3 characters are not masked (they would mangle the text), so a 1-2 character secret could show.
// Upgrade if a log line ever carries more than Claude Code's own message.
export function redact(text: string, server?: McpServer): string {
  const values = [server?.env, server?.headers].flatMap((o) => (o && typeof o === 'object' ? Object.values(o) : []));
  return values.filter((v): v is string => typeof v === 'string' && v.length >= 3).reduce((t, v) => t.split(v).join('***'), text);
}

// One log line for a server that is not connected, or undefined for one that is. Never holds an env or header value.
export function statusLine(s: McpStatus, server?: McpServer): string | undefined {
  if (s.status === 'connected') return undefined;
  const detail =
    s.status === 'needs-auth'
      ? 'needs an OAuth sign-in, which a hidden run cannot do; use a token in "headers" (with ${VAR}) instead'
      : s.status === 'failed'
        ? 'Claude Code could not start or reach it; check its "command" or "url" in mcp.json'
        : s.error ?? '';
  return redact(`${s.name} ${s.status}${detail ? `: ${detail}` : ''}`, server);
}

const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every((a) => typeof a === 'string');

function checkEntry(name: string, e: unknown): string | undefined {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return `Server "${name}" must be an object.`;
  const s = e as McpServer;
  if (s.type === 'http' || s.type === 'sse') return typeof s.url === 'string' && s.url ? undefined : `Server "${name}" needs a "url".`;
  if (s.type !== undefined && s.type !== 'stdio') return `Server "${name}" has an unknown type; use "stdio", "http" or "sse".`;
  if (typeof s.command !== 'string' || !s.command) return `Server "${name}" needs a "command" (or "type": "http" with a "url").`;
  if (s.args !== undefined && !isStrings(s.args)) return `Server "${name}": "args" must be a list of strings.`;
  return undefined;
}

// An empty file is no servers; anything wrong gives one message that names the problem, never the file's contents.
export function parseMcpConfig(text: string): McpConfig {
  if (!text.trim()) return { servers: {} };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err) {
    return { error: `mcp.json is not valid JSON: ${(err as Error).message}` };
  }
  const list = (v as { mcpServers?: unknown } | null)?.mcpServers;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return { error: 'mcp.json needs an "mcpServers" object.' };
  for (const [name, entry] of Object.entries(list)) {
    if (name === RESERVED) return { error: `"${RESERVED}" is reserved for ClaudePet's own approval server; pick another name.` };
    if (!NAME.test(name) || name.includes('__')) return { error: `Server name "${name}" is not allowed: use lowercase letters, digits, "-" and single "_".` };
    const bad = checkEntry(name, entry);
    if (bad) return { error: bad };
  }
  return { servers: list as Record<string, McpServer> };
}
