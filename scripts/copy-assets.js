// tsc does not copy non-TS files; copy the renderer's HTML/CSS next to the compiled JS.
const fs = require('node:fs');
fs.cpSync('src/renderer', 'dist/renderer', {
  recursive: true,
  filter: (src) => !src.endsWith('.ts'),
});
