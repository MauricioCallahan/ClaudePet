import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { checkSheet, loadPet, MAX_SHEET_BYTES, parsePetJson, sheetSize, type PetManifest } from './petFormat';

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
    checkSheet(size);
    return { manifest, root };
  } finally {
    zip.close();
  }
}

// The pet is already installed and the caller did not say to replace it.
export class PetExistsError extends Error {
  constructor(readonly id: string) {
    super(`a pet named "${id}" is already installed`);
  }
}

// Unpacks only the named files, so a pet folder holds nothing but its manifest and sheet. yauzl stops a file that unpacks to more than its declared size.
async function extract(zipPath: string, root: string, keep: string[], dest: string): Promise<void> {
  const zip = await openZip(zipPath);
  try {
    for (const e of (await listEntries(zip)).filter((e) => keep.includes(e.fileName))) {
      const target = path.join(dest, e.fileName.slice(root.length));
      const rel = path.relative(dest, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`the zip has an unsafe file name "${e.fileName}"`); // yauzl rejects these too
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(e, (err, s) => (err ? reject(err) : resolve(s))));
      await pipeline(stream, fs.createWriteStream(target));
    }
  } finally {
    zip.close();
  }
}

// Checks the zip, unpacks it beside the pets folder and renames it into place, so a failure leaves nothing half-installed.
export async function installPet(zipPath: string, o: { petsDir: string; tmpRoot: string; builtInDir: string; replace?: boolean }): Promise<PetManifest> {
  const { manifest, root } = await readPetZip(zipPath);
  const keep = [root + 'pet.json', root + manifest.spritesheetPath];
  const dest = path.join(o.petsDir, manifest.id);
  if (fs.existsSync(path.join(o.builtInDir, manifest.id))) throw new Error(`"${manifest.id}" is a built-in pet`);
  if (fs.existsSync(dest) && !o.replace) throw new PetExistsError(manifest.id);

  fs.mkdirSync(o.tmpRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(o.tmpRoot, 'install-')); // same drive as the pets folder, so the rename is atomic
  try {
    const staged = path.join(tmp, 'pet');
    await extract(zipPath, root, keep, staged);
    loadPet(staged); // the same check the scan does, on what was actually written
    fs.mkdirSync(o.petsDir, { recursive: true });
    if (fs.existsSync(dest)) {
      const old = path.join(tmp, 'old');
      fs.renameSync(dest, old);
      try {
        fs.renameSync(staged, dest);
      } catch (err) {
        fs.renameSync(old, dest); // keep the pet that was there
        throw err;
      }
    } else fs.renameSync(staged, dest);
    return manifest;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true }); // the failed install's files, or the replaced pet
    } catch {
      // a locked file must not turn a finished install into an error; the next start clears pets-tmp
    }
  }
}
