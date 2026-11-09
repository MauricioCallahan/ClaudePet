// tsc does not copy non-TS files; copy the renderer's HTML/CSS next to the compiled JS.
const fs = require('node:fs');
fs.cpSync('src/renderer', 'dist/renderer', {
  recursive: true,
  filter: (src) => !src.endsWith('.ts'),
});
// The renderer is compiled as ES modules (main stays CommonJS); this lets node load them for tests too.
fs.writeFileSync('dist/renderer/package.json', '{"type":"module"}\n');
