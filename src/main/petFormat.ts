import fs from 'node:fs';
import path from 'node:path';
import { isPetId } from './settings';

// The pet package format (see "Pet format" in the README), shared by the pets folder, the Codex folder and zip installs.

export interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string; // relative to the pet folder, '/'-separated
}

// spritesheetPath comes from a downloaded file and is joined to the pet folder, so it must not climb out of it.
function safeSheetPath(v: string): string {
  const p = v.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').some((s) => s === '..' || s === ''))
    throw new Error(`pet.json: spritesheetPath "${v}" must be a path inside the pet folder`);
  if (!/\.(png|webp)$/i.test(p)) throw new Error(`pet.json: spritesheetPath "${v}" must be a .png or .webp file`);
  return p;
}

export function parsePetJson(text: string): PetManifest {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('pet.json is not valid JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('pet.json must be a JSON object');
  const o = v as Record<string, unknown>;
  for (const k of ['id', 'displayName', 'spritesheetPath'])
    if (typeof o[k] !== 'string' || !(o[k] as string).trim()) throw new Error(`pet.json: "${k}" is missing or empty`);
  if (!isPetId(o.id))
    throw new Error(`pet.json: id "${o.id}" must be 1-64 lowercase letters, digits or dashes, starting with a letter or digit`);
  // Only the known fields are copied, so extras like Codex's "kind" are ignored.
  return {
    id: o.id,
    displayName: o.displayName as string,
    description: typeof o.description === 'string' ? o.description : '',
    spritesheetPath: safeSheetPath(o.spritesheetPath as string),
  };
}

export const CELL = { width: 192, height: 208 };
export const COLUMNS = 8;
const MAX_SHEET_BYTES = 20 * 1024 * 1024; // Codex's limit

// Codex's rows, top to bottom, with its per-frame timings (ms). Rows 9-10 (look directions) are still poses and not played.
const ms = (n: number, each: number, last: number) => [...Array(n - 1).fill(each), last];
export const ROWS = [
  { state: 'idle', durations: [280, 110, 110, 140, 140, 320], loop: true },
  { state: 'running-right', durations: ms(8, 120, 220), loop: true },
  { state: 'running-left', durations: ms(8, 120, 220), loop: true },
  { state: 'waving', durations: ms(4, 140, 280), loop: false },
  { state: 'jumping', durations: ms(5, 140, 280), loop: false },
  { state: 'failed', durations: ms(8, 140, 240), loop: false },
  { state: 'waiting', durations: ms(6, 150, 260), loop: true },
  { state: 'running', durations: ms(6, 120, 220), loop: true },
  { state: 'review', durations: ms(6, 150, 280), loop: true },
];
const MAX_ROWS = 11;

// Reads the size from the file header only, so no image decoder is needed (Electron's nativeImage can't read WebP).
export function sheetSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR')
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  switch (b.toString('latin1', 12, 16)) {
    case 'VP8 ': // lossy
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    case 'VP8L': {
      // lossless: 14 bits width-1, then 14 bits height-1
      const v = b.readUInt32LE(21);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    case 'VP8X': // extended: 24-bit width-1 and height-1
      return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// Any whole number of rows is accepted, so a pet with only an idle row still works.
export function checkSheet(size: { width: number; height: number }): { rows: number } {
  const rows = size.height / CELL.height;
  if (size.width !== COLUMNS * CELL.width || !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS)
    throw new Error(
      `the sprite sheet is ${size.width}x${size.height}; expected ${COLUMNS * CELL.width} wide and ${CELL.height} x rows tall, 1 to ${MAX_ROWS} rows (${COLUMNS * CELL.width}x${MAX_ROWS * CELL.height} for a full sheet)`,
    );
  return { rows };
}

export interface Pet {
  manifest: PetManifest;
  sheetPath: string;
  rows: number;
}

// Throws with the reason a folder is not a usable pet.
export function loadPet(dir: string): Pet {
  const manifest = parsePetJson(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
  const sheetPath = path.join(dir, manifest.spritesheetPath);
  if (fs.statSync(sheetPath).size > MAX_SHEET_BYTES) throw new Error('the sprite sheet is larger than 20 MB');
  const size = sheetSize(fs.readFileSync(sheetPath));
  if (!size) throw new Error('the sprite sheet is not a PNG or WebP image');
  return { manifest, sheetPath, ...checkSheet(size) };
}
