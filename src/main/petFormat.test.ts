import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePetJson } from './petFormat';

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
