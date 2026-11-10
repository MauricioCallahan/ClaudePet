import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSheet, loadPet, parsePetJson, ROWS, sheetSize } from './petFormat';

// Shaped like a real Codex pet.json, extra fields included.
const codexPet = {
  id: 'bastion-tank',
  displayName: 'Bastion Tank',
  description: 'A small tank',
  spritesheetPath: 'spritesheet.webp',
  spriteVersionNumber: 2,
  kind: 'object',
};
const parse = (patch: object) => parsePetJson(JSON.stringify({ ...codexPet, ...patch }));

test('parsePetJson reads a Codex pet.json and ignores unknown fields', () => {
  assert.deepEqual(parsePetJson(JSON.stringify(codexPet)), {
    id: 'bastion-tank',
    displayName: 'Bastion Tank',
    description: 'A small tank',
    spritesheetPath: 'spritesheet.webp',
  });
});
test('parsePetJson: a missing description is empty', () => {
  assert.equal(parse({ description: undefined }).description, '');
});
test('parsePetJson rejects text that is not a JSON object', () => {
  assert.throws(() => parsePetJson('{oops'), /not valid JSON/);
  for (const text of ['null', '[1]', '"x"']) assert.throws(() => parsePetJson(text), /JSON object/);
});
test('parsePetJson names a missing or empty required field', () => {
  for (const k of ['id', 'displayName', 'spritesheetPath']) {
    assert.throws(() => parse({ [k]: undefined }), new RegExp(`"${k}" is missing`));
    assert.throws(() => parse({ [k]: '  ' }), new RegExp(`"${k}" is missing`));
    assert.throws(() => parse({ [k]: 5 }), new RegExp(`"${k}" is missing`));
  }
});
test('parsePetJson rejects an id that is not a safe folder name', () => {
  for (const id of ['Bastion', '../x', 'a/b', '-x', 'a b', 'a'.repeat(65)]) assert.throws(() => parse({ id }), /id .* must be/);
});
test('parsePetJson rejects a sprite sheet path outside the pet folder', () => {
  for (const p of ['../x.webp', 'a/../../x.webp', '..\\x.webp', '/x.webp', 'C:\\x.webp', 'c:x.webp', '\\\\server\\x.webp', 'a//x.webp'])
    assert.throws(() => parse({ spritesheetPath: p }), /inside the pet folder/, p);
});
test('parsePetJson keeps a sheet in a subfolder, with / separators', () => {
  assert.equal(parse({ spritesheetPath: 'art\\sheet.PNG' }).spritesheetPath, 'art/sheet.PNG');
});
test('parsePetJson rejects a sprite sheet that is not PNG or WebP', () => {
  assert.throws(() => parse({ spritesheetPath: 'sheet.gif' }), /\.png or \.webp/);
});

// Just enough header bytes for sheetSize; padded to 30 like a real file would be.
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(Math.max(0, 30 - b.length))]);
const png = (w: number, h: number) => {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return pad(b);
};
const webp = (chunk: string, body: Buffer) => pad(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP' + chunk + '\0\0\0\0', 'latin1'), body]));
const vp8l = (w: number, h: number) => {
  const b = Buffer.alloc(5);
  b[0] = 0x2f;
  b.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 1);
  return webp('VP8L', b);
};
const vp8x = (w: number, h: number) => {
  const b = Buffer.alloc(10);
  b.writeUIntLE(w - 1, 4, 3);
  b.writeUIntLE(h - 1, 7, 3);
  return webp('VP8X', b);
};
const vp8 = (w: number, h: number) => {
  const b = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]);
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return webp('VP8 ', b);
};

test('sheetSize reads PNG and every kind of WebP header', () => {
  for (const make of [png, vp8l, vp8x, vp8]) assert.deepEqual(sheetSize(make(1536, 2288)), { width: 1536, height: 2288 }, make.name);
});
test('sheetSize returns null for a file that is not PNG or WebP', () => {
  assert.equal(sheetSize(Buffer.from('GIF89a' + ' '.repeat(30))), null);
  assert.equal(sheetSize(Buffer.alloc(10)), null);
  assert.equal(sheetSize(webp('ABCD', Buffer.alloc(10))), null);
});

test('checkSheet counts the rows of a Codex v1 and v2 sheet', () => {
  assert.deepEqual(checkSheet({ width: 1536, height: 1872 }), { rows: 9 });
  assert.deepEqual(checkSheet({ width: 1536, height: 2288 }), { rows: 11 });
});
test('checkSheet accepts a sheet with only the idle row', () => {
  assert.deepEqual(checkSheet({ width: 1536, height: 208 }), { rows: 1 });
});
test('checkSheet rejects a wrongly sized sheet and names the expected size', () => {
  for (const size of [{ width: 1500, height: 2288 }, { width: 1536, height: 2000 }, { width: 1536, height: 0 }, { width: 1536, height: 12 * 208 }])
    assert.throws(() => checkSheet(size), new RegExp(`is ${size.width}x${size.height}; expected 1536 wide .*1536x2288`));
});

test('ROWS follows the Codex row order and frame counts', () => {
  assert.deepEqual(
    ROWS.map((r) => [r.state, r.durations.length, r.loop]),
    [
      ['idle', 6, true],
      ['running-right', 8, true],
      ['running-left', 8, true],
      ['waving', 4, false],
      ['jumping', 5, false],
      ['failed', 8, false],
      ['waiting', 6, true],
      ['running', 6, true],
      ['review', 6, true],
    ],
  );
});

test('loadPet reads a pet folder and finds its rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-pet-'));
  try {
    fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(codexPet));
    fs.writeFileSync(path.join(dir, 'spritesheet.webp'), vp8l(1536, 1872));
    assert.deepEqual(loadPet(dir), { manifest: parsePetJson(JSON.stringify(codexPet)), sheetPath: path.join(dir, 'spritesheet.webp'), rows: 9 });
    fs.writeFileSync(path.join(dir, 'spritesheet.webp'), 'not an image, but long enough to have a header');
    assert.throws(() => loadPet(dir), /not a PNG or WebP/);
    fs.rmSync(path.join(dir, 'spritesheet.webp'));
    assert.throws(() => loadPet(dir), /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The committed test pets (made by e2e/fixtures/make-pets.js); this file runs from dist/main.
const fixture = (id: string) => path.join(__dirname, '../../e2e/fixtures/pets', id);

test('fixture: a valid pet loads with all 11 rows', () => {
  const p = loadPet(fixture('valid'));
  assert.equal(p.manifest.id, 'valid');
  assert.equal(p.rows, 11);
});
test('fixture: a pet with extra fields and only an idle row loads', () => {
  const p = loadPet(fixture('extra-fields'));
  assert.deepEqual(p.manifest, { id: 'extra-fields', displayName: 'Test extra-fields', description: 'ClaudePet test pet', spritesheetPath: 'spritesheet.png' });
  assert.equal(p.rows, 1);
});
test('fixture: a broken pet.json is rejected', () => {
  assert.throws(() => loadPet(fixture('broken-json')), /pet.json is not valid JSON/);
});
test('fixture: a wrongly sized sheet is rejected with the expected size', () => {
  assert.throws(() => loadPet(fixture('wrong-size')), /is 1536x2000; expected 1536 wide/);
});
