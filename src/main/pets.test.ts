import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPet } from './petFormat';
import { builtInPetsDir } from './pets';
import { DEFAULT_PET_ID } from './settings';

test('the default built-in pet loads, with all 11 rows', () => {
  const p = loadPet(path.join(builtInPetsDir, DEFAULT_PET_ID));
  assert.equal(p.manifest.id, DEFAULT_PET_ID);
  assert.equal(p.manifest.displayName, 'Pip');
  assert.equal(p.rows, 11);
});
