// mcp.json: the user's own MCP servers, in the shape of Claude Code's .mcp.json. Electron-free, so node --test can load it.
// An entry is passed to Claude Code as written (unknown fields included); only what could break the run config is checked.
export type McpServer = Record<string, unknown>;
export type McpConfig = { servers: Record<string, McpServer> } | { error: string };

// The name becomes part of a tool name (mcp__<name>__<tool>) and of an --allowedTools argument through a shell:
// no "__" (it separates the parts) and no trailing "_", and "claudepet" is the approval server's own.
const NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9-])?$/;
export const RESERVED = 'claudepet';

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
