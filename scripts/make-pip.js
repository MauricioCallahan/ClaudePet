// Draws the built-in pet Pip into assets/pets/pip/spritesheet.png. Run once with `node scripts/make-pip.js`; the output is committed.
// Pip is original art made only by this script: a round blob that bobs, so no third-party pet art ships with ClaudePet.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CELL_W = 192, CELL_H = 208;
const FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]; // Codex v2 rows, see the README's sprite sheet table
const BODY = [120, 190, 170], DARK = [30, 40, 50];

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Coverage of an ellipse at pixel (x, y), softened over about one pixel at the edge.
function ellipse(x, y, cx, cy, rx, ry) {
  const f = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return Math.min(1, Math.max(0, 0.5 - (f - 1) * Math.min(rx, ry)));
}

function cell(row, frame) {
  const t = frame / FRAMES[row];
  const look = row >= 9 ? ((row - 9) * 8 + frame) * Math.PI / 8 : null; // look-direction rows: still poses, 22.5° apart
  const bob = look !== null ? 0 : row === 7 ? Math.abs(Math.sin(t * 2 * Math.PI)) * -18 : Math.sin(t * 2 * Math.PI) * 4;
  const cx = 96, cy = 128 + bob, rx = 62, ry = 54 - bob / 4;
  const shapes = [[cx, cy, rx, ry, BODY]];
  if (row === 3) shapes.push([cx + 66, cy - 30 - Math.sin(t * 2 * Math.PI) * 14, 14, 14, BODY]); // waving hand
  const eye = row === 5 ? 4 : row === 7 ? 6 : 9; // small eyes when failed, squinting while running
  const [lx, ly] = look === null ? [0, 0] : [Math.sin(look) * 10, -Math.cos(look) * 10];
  for (const ex of [-22, 22]) shapes.push([cx + ex + lx, cy - 12 + ly, 7, frame === 0 && row === 0 ? 1.5 : eye, DARK]); // idle blinks on frame 0
  return (x, y) => {
    let out = [0, 0, 0, 0];
    for (const [sx, sy, srx, sry, c] of shapes) {
      const a = ellipse(x, y, sx, sy, srx, sry);
      if (a > 0) out = [...c.map((v, i) => Math.round(v * a + out[i] * (1 - a))), Math.round(255 * a + out[3] * (1 - a))];
    }
    return out;
  };
}

const width = 8 * CELL_W, height = FRAMES.length * CELL_H;
const rgba = Buffer.alloc(width * height * 4);
FRAMES.forEach((n, row) => {
  for (let frame = 0; frame < n; frame++) {
    const draw = cell(row, frame);
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++)
      rgba.set(draw(x, y), ((row * CELL_H + y) * width + frame * CELL_W + x) * 4);
  }
});
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'pets', 'pip', 'spritesheet.png'), png(width, height, rgba));
