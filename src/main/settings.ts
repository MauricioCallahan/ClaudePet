import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface Settings {
  x?: number;
  y?: number;
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

// A missing or corrupt file must never block launch, so fall back to {}.
export function loadSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

// Merge so keys added later (e.g. the hotkey) are not overwritten.
export function saveSettings(patch: Settings): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
}
