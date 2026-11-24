// What a tool activity line says while the tool runs, after it finished, and when it failed; ask follows
// "Claude wants to" on the approval card.
// Plain text: the renderer only ever sets it with textContent, so an input holding HTML stays literal.
export interface ToolLabel {
  running: string;
  done: string;
  failed: string;
  ask: string;
}

const MAX = 60;

// One line, cut to about MAX characters.
function short(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1).trimEnd()}…` : t;
}

const field = (input: unknown, key: string): string | undefined => {
  const v = input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : undefined;
};

function host(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname.replace(/^www\./, '') || 'a web page';
  } catch {
    return 'a web page';
  }
}

const words = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function toolLabel(name: string, input: unknown): ToolLabel {
  if (name === 'WebSearch') {
    const query = short(field(input, 'query') ?? '');
    const what = query ? ` for "${query}"` : '';
    return { running: `Searching the web${what}…`, done: `Searched the web${what}`, failed: 'Web search failed', ask: `search the web${what}` };
  }
  if (name === 'WebFetch') {
    const site = host(field(input, 'url'));
    return { running: `Reading ${site}…`, done: `Read ${site}`, failed: `Couldn't read ${site}`, ask: `read ${site}` };
  }
  // mcp__<server>__<tool>: the server name ends at the first "__".
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    const label = short(`${words(mcp[1])}: ${mcp[2].replace(/_/g, ' ').trim()}`);
    return { running: `${label}…`, done: label, failed: `${label} failed`, ask: `use ${label}` };
  }
  const tool = short(name);
  return { running: `Using ${tool}…`, done: `Used ${tool}`, failed: `${tool} failed`, ask: `use ${tool}` };
}
