import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addCopyButtons, codeToCopy } from './codeBlocks.js';

function page(html: string): ParentNode {
  const div = new JSDOM('<body></body>').window.document.createElement('div');
  div.innerHTML = html;
  return div;
}

test('adds one Copy button per code block, only once', () => {
  const root = page('<pre><code>a</code></pre><pre><code>b</code></pre>');
  addCopyButtons(root);
  addCopyButtons(root);
  assert.equal(root.querySelectorAll('button.copy').length, 2);
});

test('copies the exact code, not the button label', () => {
  const root = page('<pre><code>  if (a &lt; b &amp;&amp; c) {\n    x();\n  }\n</code></pre>');
  addCopyButtons(root);
  assert.equal(codeToCopy(root.querySelector('button.copy')), '  if (a < b && c) {\n    x();\n  }\n');
});

test('ignores clicks elsewhere', () => {
  const root = page('<p>hi</p><pre><code>a</code></pre>');
  addCopyButtons(root);
  assert.equal(codeToCopy(root.querySelector('p')), null);
  assert.equal(codeToCopy(root.querySelector('code')), null);
  assert.equal(codeToCopy(null), null);
});
