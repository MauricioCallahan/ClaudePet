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
