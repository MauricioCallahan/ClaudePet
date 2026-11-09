// The renderer has no bundler: copy the ESM builds (and their types) of its libraries next to the source,
// so tsc can type-check './vendor/...' imports and copy-assets ships them with the renderer.
const fs = require('node:fs');
fs.mkdirSync('src/renderer/vendor', { recursive: true });
for (const [from, to] of [
  ['node_modules/marked/lib/marked.esm.js', 'marked.esm.js'],
  ['node_modules/marked/lib/marked.d.ts', 'marked.esm.d.ts'],
  ['node_modules/dompurify/dist/purify.es.mjs', 'purify.es.mjs'],
  ['node_modules/dompurify/dist/purify.es.d.mts', 'purify.es.d.mts'],
]) fs.copyFileSync(from, `src/renderer/vendor/${to}`);
