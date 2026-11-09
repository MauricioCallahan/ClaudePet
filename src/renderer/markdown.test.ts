import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import DOMPurify from './vendor/purify.es.mjs';
import { renderMarkdown } from './markdown.js';

const purify = DOMPurify(new JSDOM('').window as unknown as Window & typeof globalThis);

test('renders headings, lists, links and code', () => {
  const html = renderMarkdown('# Title\n\n- one\n- two\n\n[site](https://example.com)\n\n```\nconst a = 1;\n```', purify);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<a href="https:\/\/example.com">site<\/a>/);
  assert.match(html, /<pre><code>const a = 1;\n<\/code><\/pre>/);
});

test('removes script tags', () => {
  const html = renderMarkdown('hi <script>alert(1)</script> there', purify);
  assert.doesNotMatch(html, /script|alert/);
});

test('removes event handlers', () => {
  const html = renderMarkdown('<img src="x" onerror="alert(1)">', purify);
  assert.doesNotMatch(html, /onerror/);
});

test('removes javascript: links', () => {
  const html = renderMarkdown('[bad](javascript:alert(1))', purify);
  assert.doesNotMatch(html, /javascript:/);
});
