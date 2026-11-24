// ClaudePet's answer to one approval request, and the shape Claude Code expects back from the approve tool.
// Electron-free and Node-only, so both the approval server and main can load it.

export type Verdict = { allow: true } | { allow: false; message: string };

export const NO_ANSWER = 'ClaudePet did not answer, so the tool was not run.';

// Anything that is not a clear allow is a deny: the verdict comes over a pipe and must never fail open.
export function toVerdict(v: unknown): Verdict {
  if (v && typeof v === 'object' && (v as { allow?: unknown }).allow === true) return { allow: true };
  const message = (v as { message?: unknown } | null)?.message;
  return { allow: false, message: typeof message === 'string' && message ? message.slice(0, 500) : NO_ANSWER };
}

// The text block Claude Code reads: allow passes the input through unchanged, deny reaches Claude as the tool's error.
export function decide(v: Verdict, input: unknown): { content: { type: 'text'; text: string }[] } {
  const body = v.allow ? { behavior: 'allow', updatedInput: input && typeof input === 'object' ? input : {} } : { behavior: 'deny', message: v.message };
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}
