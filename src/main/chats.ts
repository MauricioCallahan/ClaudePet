import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Chat: text only, none of your Claude Code setup. Code (v0.3): tools, your setup, a project folder.
export type Mode = 'chat' | 'code';

export interface Chat {
  id: string;
  title: string;
  updatedAt: number;
  sessionId?: string; // Claude Code session to resume on follow-ups
  mode?: Mode; // missing = 'chat' (chats saved before modes existed)
}

const file = () => path.join(app.getPath('userData'), 'chats.json');

// Drop anything that is not a well-formed entry; a corrupt file must never block launch.
export function parseChats(text: string): Chat[] {
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (c): c is Chat =>
        !!c &&
        typeof c.id === 'string' &&
        typeof c.title === 'string' &&
        typeof c.updatedAt === 'number' &&
        (c.sessionId === undefined || typeof c.sessionId === 'string') &&
        (c.mode === undefined || c.mode === 'chat' || c.mode === 'code'),
    );
  } catch {
    return [];
  }
}

export function makeTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 39) + '…' : t;
}

// The title comes from the first message only; later messages just bump updatedAt.
export function upsert(chats: Chat[], id: string, text: string, now: number): Chat[] {
  const old = chats.find((c) => c.id === id);
  const next: Chat = { mode: 'chat', ...old, id, title: old?.title ?? makeTitle(text), updatedAt: now };
  return [next, ...chats.filter((c) => c.id !== id)];
}

export function setSession(chats: Chat[], id: string, sessionId: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, sessionId } : c));
}

export function recent(chats: Chat[], n = 10): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n);
}

export function loadChats(): Chat[] {
  try {
    return parseChats(fs.readFileSync(file(), 'utf8'));
  } catch {
    return [];
  }
}

// Temp file + rename, as in settings.ts, so a crash can't leave half a file.
export function saveChats(chats: Chat[]): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(chats, null, 2));
    fs.renameSync(tmp, file());
  } catch {
    // shortcut: save errors are silent, the index is rebuilt by M2 once chats hold real history
  }
}
