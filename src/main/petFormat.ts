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
