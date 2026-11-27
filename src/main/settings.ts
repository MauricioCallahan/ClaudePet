import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface Settings {
  x?: number;
  y?: number;
  hotkey?: string; // Electron accelerator, default CommandOrControl+,
  model?: string; // Claude Code model alias or full id, default sonnet (picker UI in v0.2)
  pet?: { enabled?: unknown; id?: unknown }; // read through petSettings; saveSettings merges shallowly, so save the whole object
  ui?: { compact?: unknown }; // read through uiSettings, once at startup
  tools?: unknown; // read through toolSettings on every send; saveSettings merges shallowly, so save the whole object
  connectors?: unknown; // { "<server in mcp.json>": { enabled } }, read through connectorSettings on every send; save the whole object
}

export type ToolSettings = { webSearch: boolean; webFetch: boolean };

export const DEFAULT_PET_ID = 'pip'; // the built-in pet in assets/pets/pip

// Pet ids become folder names under pets\: letters (any case), digits, '_', '.' and '-', wide enough for Codex pets,
// with no slash, colon or space, so an id is always one folder inside pets\. It may not start with '.' or '-',
// nor end with '.' (Windows drops a trailing dot from a folder name).
export const isPetId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9](?:[\w.-]{0,62}[\w-])?$/.test(v);

// The settings file is hand-editable: any bad value falls back to its default.
export function petSettings(s: Settings): { enabled: boolean; id: string } {
  const p = s.pet && typeof s.pet === 'object' ? s.pet : {};
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
    id: isPetId(p.id) ? p.id : DEFAULT_PET_ID,
  };
}

// compact: the box opens as the small pet bar and grows into the chat (default); false keeps the full 360x480 box.
export function uiSettings(s: Settings): { compact: boolean } {
  const u = s.ui && typeof s.ui === 'object' ? s.ui : {};
  return { compact: typeof u.compact === 'boolean' ? u.compact : true };
}

// The read-only web tools are on by default; only a real false turns one off (a typo, "false" or null leaves it on).
export function toolSettings(s: Settings): ToolSettings {
  const t: { webSearch?: unknown; webFetch?: unknown } = s.tools && typeof s.tools === 'object' ? s.tools : {};
  return { webSearch: t.webSearch !== false, webFetch: t.webFetch !== false };
}

// Which mcp.json servers the user turned off: a server is on unless its "enabled" is a real false (a typo leaves it on).
export function connectorSettings(s: Settings): Record<string, boolean> {
  const c = s.connectors && typeof s.connectors === 'object' && !Array.isArray(s.connectors) ? Object.entries(s.connectors) : [];
  return Object.fromEntries(c.map(([name, v]) => [name, (v as { enabled?: unknown } | null)?.enabled !== false]));
}

export type Rule = 'allow' | 'ask' | 'deny';
export type Rules = Record<string, Rule>;
const RULES: readonly unknown[] = ['allow', 'ask', 'deny'];

// tools.approval: { "<tool or mcp__server>": "allow" | "ask" | "deny" }. A name can become an --allowedTools argument
// through a shell, so only plain tool names are kept (letters, digits, "_" and "-", never starting with "-", so a flag is
// impossible); anything else in the file is dropped, never passed on.
export function approvalRules(s: Settings): Rules {
  const t = s.tools && typeof s.tools === 'object' ? (s.tools as { approval?: unknown }).approval : undefined;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
  return Object.fromEntries(Object.entries(t).filter(([name, rule]) => /^[A-Za-z0-9][\w-]{0,127}$/.test(name) && RULES.includes(rule))) as Rules;
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
