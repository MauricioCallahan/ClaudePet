import { marked } from './vendor/marked.esm.js';

// Anything with sanitize(html), i.e. a DOMPurify instance; passed in so tests can supply a jsdom-backed one.
export interface Sanitizer {
  sanitize(html: string): string;
}

// Replies are untrusted: parse the Markdown, then strip scripts, event handlers and javascript: links.
export function renderMarkdown(raw: string, purify: Sanitizer): string {
  return purify.sanitize(marked.parse(raw, { async: false }));
}
