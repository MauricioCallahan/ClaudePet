import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPet, type Pet } from './petFormat';
import { DEFAULT_PET_ID } from './settings';

// Installed pets, one folder per pet named after its id: %APPDATA%\ClaudePet\pets\<id>\.
export const userPetsDir = () => path.join(app.getPath('userData'), 'pets');

// A folder we can't create only means no installed pets; it must not stop the app.
export function ensurePetsDir(): void {
  try {
    fs.mkdirSync(userPetsDir(), { recursive: true });
  } catch (err) {
    console.error('Could not create the pets folder:', (err as Error).message);
  }
}

// Shipped with the app and read in place, like assets/tray.ico.
export const builtInPetsDir = path.join(__dirname, '../../assets/pets');

// Where `npx codex-pets add` puts pets. ClaudePet only ever reads it.
export const codexPetsDir = (env: NodeJS.ProcessEnv, home: string) => path.join(env.CODEX_HOME || path.join(home, '.codex'), 'pets');

export type PetSource = 'built-in' | 'user' | 'codex';
export type ListedPet = Pet & { source: PetSource };
export type PetScan = { pets: ListedPet[]; skipped: { dir: string; reason: string }[] };

// Sources in priority order: the first copy of an id wins, so nothing replaces a built-in pet and ClaudePet's copy beats Codex's.
export function listPets(sources: { dir: string; source: PetSource }[]): PetScan {
  const pets: ListedPet[] = [];
  const skipped: PetScan['skipped'] = [];
  for (const { dir, source } of sources) {
    let names: string[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      // A missing folder (no Codex installed) is normal.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') skipped.push({ dir, reason: (err as Error).message });
      continue;
    }
    for (const name of names) {
      const d = path.join(dir, name);
      try {
        const p = loadPet(d);
        if (p.manifest.id !== name) throw new Error(`the folder name "${name}" does not match its id "${p.manifest.id}"`);
        const first = pets.find((q) => q.manifest.id === name);
        if (first) throw new Error(first.source === 'built-in' ? `"${name}" is a built-in pet` : `the ClaudePet copy of "${name}" is used instead`);
        pets.push({ ...p, source });
      } catch (err) {
        skipped.push({ dir: d, reason: (err as Error).message });
      }
    }
  }
  return { pets, skipped };
}

// Every usable pet, built-in first; folders that aren't are logged with the reason.
export function scanPets(): PetScan {
  const scan = listPets([
    { dir: builtInPetsDir, source: 'built-in' },
    { dir: userPetsDir(), source: 'user' },
    { dir: codexPetsDir(process.env, os.homedir()), source: 'codex' },
  ]);
  for (const s of scan.skipped) console.error(`Pet folder ${s.dir} skipped: ${s.reason}`);
  return scan;
}

// The chosen pet, or the built-in default with the reason why. pet.id is never rewritten, so the pet returns if its folder does.
export function pickPet({ pets, skipped }: PetScan, id: string): { pet: ListedPet | undefined; reason?: string } {
  const chosen = pets.find((p) => p.manifest.id === id);
  if (chosen) return { pet: chosen };
  const bad = skipped.find((s) => path.basename(s.dir) === id);
  const why = bad ? `is not valid (${bad.reason})` : 'is not installed';
  return { pet: pets.find((p) => p.manifest.id === DEFAULT_PET_ID), reason: `Pet "${id}" ${why}; showing "${DEFAULT_PET_ID}" instead` };
}
