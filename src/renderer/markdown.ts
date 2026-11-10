import { marked } from './vendor/marked.esm.js';

// Anything with sanitize(html), i.e. a DOMPurify instance; passed in so tests can supply a jsdom-backed one.
export interface Sanitizer {
  sanitize(html: string, config: { FORBID_TAGS: string[]; FORBID_ATTR: string[] }): string;
}

// No form controls (a reply could fake a login box) and no class (a reply could fake our Copy buttons).
const STRICT = { FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'style'], FORBID_ATTR: ['class'] };

// Replies are untrusted: parse the Markdown, then strip scripts, event handlers and javascript: links.
export function renderMarkdown(raw: string, purify: Sanitizer): string {
  return purify.sanitize(marked.parse(raw, { async: false }), STRICT);
}
