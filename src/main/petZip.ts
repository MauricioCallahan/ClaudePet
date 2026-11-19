import fs from 'node:fs';
import yauzl from 'yauzl';
import { checkSheet, MAX_SHEET_BYTES, parsePetJson, sheetSize, type PetManifest } from './petFormat';

// Checks a pet zip (Codex's format, see "Pet format" in the README) without unpacking it.

const MiB = 1024 * 1024;
export const MAX_ZIP_BYTES = 20 * MiB;
export const MAX_UNPACKED_BYTES = 50 * MiB;
export const MAX_FILES = 10;
const MAX_ENTRIES = 100; // files and folders; stops a zip of a million empty folders before it is all listed
const MAX_JSON_BYTES = 64 * 1024;

export interface PetZip {
  manifest: PetManifest;
  root: string; // '' when pet.json is at the top level, else 'folder/'
  rows: number;
  files: { name: string; size: number }[]; // every file, names as in the zip
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    // autoClose off: the entries are read after the list is done, and the caller closes
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(new Error(`not a readable zip file (${err.message})`)) : resolve(zip))),
  );
}

// yauzl itself rejects absolute paths, backslashes and `..` in names.
function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const list: yauzl.Entry[] = [];
    let files = 0;
    zip.on('error', (err) => reject(new Error(`the zip is not valid: ${err.message}`)));
    zip.on('end', () => resolve(list));
    zip.on('entry', (e: yauzl.Entry) => {
      list.push(e);
      if (!e.fileName.endsWith('/')) files++;
      if (files > MAX_FILES) return reject(new Error(`the zip has more than ${MAX_FILES} files`));
      if (list.length > MAX_ENTRIES) return reject(new Error('the zip has too many entries'));
      zip.readEntry();
    });
    zip.readEntry();
  });
}

// The first `max` bytes of an entry (all of it if shorter).
function readStart(zip: yauzl.ZipFile, entry: yauzl.Entry, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const parts: Buffer[] = [];
      let n = 0;
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(parts)));
      stream.on('data', (c: Buffer) => {
        parts.push(c);
        n += c.length;
        if (n >= max) {
          resolve(Buffer.concat(parts).subarray(0, max));
          stream.destroy();
        }
      });
    }),
  );
}

// Throws with the reason a zip is not an installable pet.
export async function readPetZip(zipPath: string): Promise<PetZip> {
  if (fs.statSync(zipPath).size > MAX_ZIP_BYTES) throw new Error('the zip is larger than 20 MB');
  const zip = await openZip(zipPath);
  try {
    const all = await listEntries(zip);
    const entries = all.filter((e) => !e.fileName.endsWith('/'));
    if (entries.reduce((sum, e) => sum + e.uncompressedSize, 0) > MAX_UNPACKED_BYTES) throw new Error('the zip unpacks to more than 50 MB');
    // Windows folders ignore case, so two names that differ only in case would overwrite each other.
    const seen = new Set<string>();
    for (const e of entries) {
      const key = e.fileName.toLowerCase();
      if (seen.has(key)) throw new Error(`the zip has "${e.fileName}" twice`);
      seen.add(key);
    }

    const json = entries.find((e) => e.fileName === 'pet.json' || /^[^/]+\/pet\.json$/.test(e.fileName));
    if (!json) throw new Error('the zip has no pet.json at the top level or inside one folder');
    const root = json.fileName.slice(0, -'pet.json'.length);
    if (root && entries.some((e) => !e.fileName.startsWith(root))) throw new Error(`the zip's files must all be at the top level or all inside "${root}"`);
    if (json.uncompressedSize > MAX_JSON_BYTES) throw new Error('pet.json is larger than 64 KB');
    const manifest = parsePetJson((await readStart(zip, json, MAX_JSON_BYTES)).toString('utf8'));

    const sheet = entries.find((e) => e.fileName === root + manifest.spritesheetPath);
    if (!sheet) throw new Error(`the zip has no sprite sheet at "${manifest.spritesheetPath}"`);
    if (sheet.uncompressedSize > MAX_SHEET_BYTES) throw new Error('the sprite sheet is larger than 20 MB');
    const size = sheetSize(await readStart(zip, sheet, 30));
    if (!size) throw new Error('the sprite sheet is not a PNG or WebP image');
    const { rows } = checkSheet(size);
    return { manifest, root, rows, files: entries.map((e) => ({ name: e.fileName, size: e.uncompressedSize })) };
  } finally {
    zip.close();
  }
}
