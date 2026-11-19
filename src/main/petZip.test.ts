import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { readPetZip } from './petZip';

// The committed test pets; this file runs from dist/main.
const fixtures = path.join(__dirname, '../../e2e/fixtures/pets');
const fixture = (pet: string, file: string) => fs.readFileSync(path.join(fixtures, pet, file));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-zip-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
// Writes a zip of name -> content. `swap` rewrites a text in every file name afterwards, for names yazl refuses to write (like `../`).
async function makeZip(files: Record<string, Buffer | string>, opts: { store?: boolean; swap?: [string, string] } = {}): Promise<string> {
  const z = new yazl.ZipFile();
  for (const [name, data] of Object.entries(files)) z.addBuffer(Buffer.from(data), name, { compress: !opts.store });
  z.end();
  const chunks: Buffer[] = [];
  for await (const c of z.outputStream) chunks.push(c as Buffer);
  let out = Buffer.concat(chunks);
  if (opts.swap) out = Buffer.from(out.toString('latin1').replaceAll(opts.swap[0], opts.swap[1]), 'latin1'); // same length, and names are not in the CRC
  const file = path.join(dir, `${n++}.zip`);
  fs.writeFileSync(file, out);
  return file;
}

const json = (over: object = {}) => JSON.stringify({ ...JSON.parse(fixture('valid', 'pet.json').toString()), ...over });
const good = () => ({ 'pet.json': json(), 'spritesheet.png': fixture('valid', 'spritesheet.png') });

test('readPetZip accepts a pet at the top level of the zip', async () => {
  const r = await readPetZip(await makeZip(good()));
  assert.equal(r.manifest.id, 'valid');
  assert.equal(r.root, '');
  assert.equal(r.rows, 11);
  assert.deepEqual(r.files.map((f) => f.name), ['pet.json', 'spritesheet.png']);
});

test('readPetZip accepts a pet inside one folder', async () => {
  const r = await readPetZip(await makeZip({ 'valid/pet.json': json(), 'valid/spritesheet.png': fixture('valid', 'spritesheet.png') }));
  assert.equal(r.manifest.id, 'valid');
  assert.equal(r.root, 'valid/');
});

test('readPetZip ignores unknown pet.json fields', async () => {
  const r = await readPetZip(await makeZip({ ...good(), 'pet.json': json({ kind: 'person', extra: 1 }) }));
  assert.equal(r.manifest.id, 'valid');
});

test('readPetZip rejects a zip with no pet.json', async () => {
  await assert.rejects(readPetZip(await makeZip({ 'spritesheet.png': fixture('valid', 'spritesheet.png') })), /no pet\.json/);
});

test('readPetZip rejects a pet.json that is not valid', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'pet.json': '{ nope' })), /not valid JSON/);
});

test('readPetZip rejects a zip with no sprite sheet', async () => {
  await assert.rejects(readPetZip(await makeZip({ 'pet.json': json() })), /no sprite sheet at "spritesheet\.png"/);
});

test('readPetZip rejects a ../ path', async () => {
  const zip = await makeZip({ ...good(), 'zz/pet.json': 'x' }, { swap: ['zz/pet.json', '../pet.json'] });
  await assert.rejects(readPetZip(zip), /\.\.\/pet\.json/);
});

test('readPetZip rejects an absolute path', async () => {
  const zip = await makeZip({ ...good(), 'zz/evil.txt': 'x' }, { swap: ['zz/evil.txt', '/zz/evil.tx'] });
  await assert.rejects(readPetZip(zip), /absolute path/);
});

test('readPetZip rejects a wrong-size sprite sheet, naming the expected size', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'spritesheet.png': fixture('wrong-size', 'spritesheet.png') })), /expected 1536 wide/);
});

test('readPetZip rejects a sprite sheet that is not an image', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'spritesheet.png': 'not an image, but long enough to have a header' })), /not a PNG or WebP/);
});

test('readPetZip rejects a bad id', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'pet.json': json({ id: 'Bad Id' }) })), /id "Bad Id"/);
});

test('readPetZip rejects a spritesheetPath that climbs out of the pet folder', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'pet.json': json({ spritesheetPath: '../spritesheet.png' }) })), /inside the pet folder/);
});

test('readPetZip rejects files split between the top level and a folder', async () => {
  await assert.rejects(readPetZip(await makeZip({ 'valid/pet.json': json(), 'spritesheet.png': fixture('valid', 'spritesheet.png') })), /all inside "valid\/"/);
});

test('readPetZip rejects names that differ only in case', async () => {
  await assert.rejects(readPetZip(await makeZip({ ...good(), 'Pet.json': json() })), /twice/);
});

test('readPetZip rejects more than 10 files', async () => {
  const files: Record<string, string | Buffer> = good();
  for (let i = 0; i < 9; i++) files[`extra${i}.txt`] = 'x';
  await assert.rejects(readPetZip(await makeZip(files)), /more than 10 files/); // 2 + 9 = 11
});

test('readPetZip rejects a zip over 20 MB', async () => {
  const big = await makeZip({ ...good(), 'big.bin': crypto.randomBytes(21 * 1024 * 1024) }, { store: true });
  await assert.rejects(readPetZip(big), /larger than 20 MB/);
});

test('readPetZip rejects a zip that unpacks to over 50 MB', async () => {
  const bomb = await makeZip({ ...good(), 'big.bin': Buffer.alloc(51 * 1024 * 1024) }); // zeros: a few KB zipped
  assert.ok(fs.statSync(bomb).size < 1024 * 1024);
  await assert.rejects(readPetZip(bomb), /more than 50 MB/);
});

test('readPetZip rejects a file that is not a zip', async () => {
  const file = path.join(dir, 'plain.zip');
  fs.writeFileSync(file, 'this is not a zip file, just text');
  await assert.rejects(readPetZip(file), /not a readable zip/);
});
