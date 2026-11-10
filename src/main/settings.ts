import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface Settings {
  x?: number;
  y?: number;
  hotkey?: string; // Electron accelerator, default CommandOrControl+,
  model?: string; // Claude Code model alias or full id, default sonnet (picker UI in v0.2)
  pet?: { enabled?: unknown; id?: unknown }; // read through petSettings; saveSettings merges shallowly, so save the whole object
}

export const DEFAULT_PET_ID = 'default'; // shortcut: placeholder id, rename when bullet 3 ships the built-in pet

// Pet ids become folder names under pets\, so only lowercase letters, digits and dashes.
export const isPetId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);

// The settings file is hand-editable: any bad value falls back to its default.
export function petSettings(s: Settings): { enabled: boolean; id: string } {
  const p = s.pet && typeof s.pet === 'object' ? s.pet : {};
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
    id: isPetId(p.id) ? p.id : DEFAULT_PET_ID,
  };
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

// Valid JSON that is not an object (e.g. `null`) would crash the destructuring in main.ts.
export function parseSettings(text: string): Settings {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// A missing or corrupt file must never block launch, so fall back to {}.
export function loadSettings(): Settings {
  try {
    return parseSettings(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

// Merge so keys added later (e.g. the hotkey) are not overwritten.
// Write to a temp file, then rename over the real one, so a crash can't leave half a file.
export function saveSettings(patch: Settings): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
    fs.renameSync(tmp, file());
  } catch {
    // shortcut: save errors are silent (a lost window position is harmless), revisit when settings hold anything the user must not lose
  }
}
