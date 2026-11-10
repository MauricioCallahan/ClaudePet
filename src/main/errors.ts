// The failures the pet explains in plain words; everything else is shown as Claude Code reported it.
export type ErrorCase = 'not-installed' | 'not-signed-in' | 'usage-limit' | 'network' | 'timeout' | 'unknown';

// Matched against Claude Code's error result, stderr and spawn errors, in this order.
const PATTERNS: [ErrorCase, RegExp][] = [
  // 9009 / "not recognized": cmd.exe could not find the program (e.g. the .cmd shim's node is gone).
  ['not-installed', /is not recognized as an internal or external command|\bENOENT\b|not installed/i],
  ['not-signed-in', /not logged in|\/login|invalid api key|oauth token|authentication (required|failed)|sign in again/i],
  // Not just "limit reached": "Context limit reached" is not a usage limit.
  ['usage-limit', /usage limit|hit your (\w+ )*limit|\b(session|weekly|5-hour|opus|sonnet) limit/i],
  ['network', /connection error|request timed out|\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|fetch failed|internet connection/i],
];

export function classify(text: string, code?: number | null): ErrorCase {
  if (code === 9009) return 'not-installed';
  return PATTERNS.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
}

// What the renderer shows. retry adds a Retry button; link is opened in the browser.
export interface ReplyError {
  case: ErrorCase;
  message: string;
  link?: string;
  retry?: boolean;
}

export const INSTALL_URL = 'https://claude.com/claude-code';

// Known cases get the fix in plain words; unknown keeps Claude Code's own text, the only clue there is.
// resetsAt: unix seconds, from Claude Code's rate_limit_event.
export function describe(c: ErrorCase, detail: string, resetsAt?: number): ReplyError {
  switch (c) {
    case 'not-installed':
      return { case: c, message: "Claude Code isn't installed. Install it, then try again:", link: INSTALL_URL };
    case 'not-signed-in':
      return { case: c, message: "You're not signed in to Claude Code. Run `claude` once in a terminal and sign in, then try again." };
    case 'usage-limit': {
      const when = resetsAt && new Date(resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      return { case: c, message: `You've reached your Claude usage limit. ${when ? `It resets ${when}.` : 'Try again later.'}` };
    }
    case 'network':
      return { case: c, message: "Can't reach Claude. Check your internet connection.", retry: true };
    case 'timeout':
      return { case: c, message: 'Claude stopped responding.', retry: true };
    default:
      return { case: c, message: detail };
  }
}

// detail and code are what Claude Code reported, kept for the log.
export class BridgeError extends Error {
  constructor(
    readonly info: ReplyError,
    readonly detail = info.message,
    readonly code?: number | null,
  ) {
    super(info.message);
  }
}

// A rejected rate_limit_event (resetsAt set) means the limit, whatever the error text says.
export const toBridgeError = (detail: string, code?: number | null, resetsAt?: number) =>
  new BridgeError(describe(resetsAt === undefined ? classify(detail, code) : 'usage-limit', detail, resetsAt), detail, code);

// One line per failed reply. Only Claude Code's error text goes in, never a message or a reply.
export function logLine(at: Date, c: ErrorCase, code: number | null | undefined, detail: string): string {
  const text = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `${at.toISOString()} ${c}${code == null ? '' : ` exit=${code}`}${text ? ` ${text}` : ''}\n`;
}
