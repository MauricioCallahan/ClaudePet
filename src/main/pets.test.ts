import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPet } from './petFormat';
import { builtInPetsDir, codexPetsDir, listPets, type PetSource } from './pets';
import { DEFAULT_PET_ID } from './settings';

test('the default built-in pet loads, with all 11 rows', () => {
  const p = loadPet(path.join(builtInPetsDir, DEFAULT_PET_ID));
  assert.equal(p.manifest.id, DEFAULT_PET_ID);
  assert.equal(p.manifest.displayName, 'Pip');
  assert.equal(p.rows, 11);
});

test('codexPetsDir follows CODEX_HOME, else ~/.codex', () => {
  assert.equal(codexPetsDir({ CODEX_HOME: 'D:\\codex' }, 'C:\\Users\\me'), path.join('D:\\codex', 'pets'));
  assert.equal(codexPetsDir({}, 'C:\\Users\\me'), path.join('C:\\Users\\me', '.codex', 'pets'));
});

// The committed test pets; this file runs from dist/main.
const fixtures = path.join(__dirname, '../../e2e/fixtures/pets');

// A copy of a fixture pet in <root>/<folder>, with its pet.json id set to `id`.
function addPet(root: string, folder: string, id = folder, fixture = 'valid'): void {
  const dir = path.join(root, folder);
  fs.cpSync(path.join(fixtures, fixture), dir, { recursive: true });
  const file = path.join(dir, 'pet.json');
  if (fixture !== 'broken-json') fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), id }));
}

function withFolders(run: (dirs: Record<PetSource, string>) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-pets-'));
  const dirs = { 'built-in': path.join(root, 'built-in'), user: path.join(root, 'user'), codex: path.join(root, 'codex') };
  try {
    run(dirs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const list = (dirs: Record<PetSource, string>) =>
  listPets((['built-in', 'user', 'codex'] as const).map((source) => ({ dir: dirs[source], source })));
const ids = (r: ReturnType<typeof listPets>) => r.pets.map((p) => `${p.source}:${p.manifest.id}`);

test('listPets lists built-in, then ClaudePet, then Codex pets', () => {
  withFolders((dirs) => {
    addPet(dirs['built-in'], 'pip');
    addPet(dirs.user, 'mine');
    addPet(dirs.codex, 'from-codex');
    const r = list(dirs);
    assert.deepEqual(ids(r), ['built-in:pip', 'user:mine', 'codex:from-codex']);
    assert.deepEqual(r.skipped, []);
  });
});

test('listPets: missing folders (no Codex installed) are not an error', () => {
  withFolders((dirs) => {
    addPet(dirs['built-in'], 'pip');
    const r = list(dirs);
    assert.deepEqual(ids(r), ['built-in:pip']);
    assert.deepEqual(r.skipped, []);
  });
});

test('listPets skips a broken pet with the reason and keeps the rest', () => {
  withFolders((dirs) => {
    addPet(dirs.user, 'broken-json', 'broken-json', 'broken-json');
    addPet(dirs.user, 'ok');
    const r = list(dirs);
    assert.deepEqual(ids(r), ['user:ok']);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].dir, path.join(dirs.user, 'broken-json'));
    assert.match(r.skipped[0].reason, /not valid JSON/);
  });
});

test('listPets skips a folder whose name does not match its id', () => {
  withFolders((dirs) => {
    addPet(dirs.user, 'renamed', 'valid');
    const r = list(dirs);
    assert.deepEqual(r.pets, []);
    assert.match(r.skipped[0].reason, /folder name "renamed" does not match its id "valid"/);
  });
});

test('listPets: the ClaudePet copy of a pet beats the Codex copy', () => {
  withFolders((dirs) => {
    addPet(dirs.user, 'twin');
    addPet(dirs.codex, 'twin');
    const r = list(dirs);
    assert.deepEqual(ids(r), ['user:twin']);
    assert.match(r.skipped[0].reason, /ClaudePet copy of "twin" is used/);
  });
});

test('listPets: no installed pet replaces a built-in one', () => {
  withFolders((dirs) => {
    addPet(dirs['built-in'], 'pip');
    addPet(dirs.user, 'pip');
    addPet(dirs.codex, 'pip');
    const r = list(dirs);
    assert.deepEqual(ids(r), ['built-in:pip']);
    assert.deepEqual(
      r.skipped.map((s) => s.reason),
      ['"pip" is a built-in pet', '"pip" is a built-in pet'],
    );
  });
});

test('listPets ignores loose files next to the pet folders', () => {
  withFolders((dirs) => {
    addPet(dirs.user, 'ok');
    fs.writeFileSync(path.join(dirs.user, 'notes.txt'), 'hi');
    assert.deepEqual(ids(list(dirs)), ['user:ok']);
  });
});
