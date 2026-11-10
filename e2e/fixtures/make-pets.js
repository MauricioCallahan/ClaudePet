// Writes the test pets in e2e/fixtures/pets/. Run once with `node e2e/fixtures/make-pets.js`; the output is committed.
// Each used cell is a square in its row's colour with a white bar whose width counts the frame (1 to 8), so playback is easy to follow by eye.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CELL_W = 192, CELL_H = 208;
const FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]; // Codex v2 rows

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function sheet(rows, height = rows * CELL_H) {
  const width = 8 * CELL_W;
  const raw = Buffer.alloc((width * 4 + 1) * height); // RGBA, filter byte 0 per line, transparent by default
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / CELL_H), cy = y % CELL_H;
    const [r, g, b] = [(row * 97) % 256, (row * 53 + 120) % 256, (row * 181 + 60) % 256];
    for (let x = 0; x < width; x++) {
      const frame = Math.floor(x / CELL_W), cx = x % CELL_W;
      if (frame >= (FRAMES[row] ?? 0) || cx < 24 || cx >= CELL_W - 24 || cy < 24 || cy >= CELL_H - 24) continue;
      const bar = cy >= CELL_H - 64 && cy < CELL_H - 40 && cx < 32 + (frame + 1) * 16;
      raw.set(bar ? [255, 255, 255, 255] : [r, g, b, 255], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pet(id, manifest, png) {
  const dir = path.join(__dirname, 'pets', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pet.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2) + '\n');
  if (png) fs.writeFileSync(path.join(dir, 'spritesheet.png'), png);
}

const manifest = (id) => ({ id, displayName: `Test ${id}`, description: 'ClaudePet test pet', spritesheetPath: 'spritesheet.png' });

pet('valid', manifest('valid'), sheet(11));
pet('broken-json', JSON.stringify(manifest('broken-json')).slice(0, 40), sheet(1));
pet('wrong-size', manifest('wrong-size'), sheet(10, 2000));
// Codex's extra fields plus one nested object; a one-row sheet, so it also stands for a pet with only an idle row.
pet('extra-fields', { ...manifest('extra-fields'), spriteVersionNumber: 2, kind: 'object', author: { name: 'ClaudePet tests' } }, sheet(1));
