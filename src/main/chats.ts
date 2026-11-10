import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Chat: text only, none of your Claude Code setup. Code (v0.3): tools, your setup, a project folder.
export type Mode = 'chat' | 'code';

export interface Chat {
  id: string;
  title: string;
  createdAt?: number; // missing on chats saved before M2-5; use updatedAt
  updatedAt: number;
  sessionId?: string; // Claude Code session to resume on follow-ups
  mode?: Mode; // missing = 'chat' (chats saved before modes existed)
}

export interface Message {
  role: 'user' | 'claude';
  text: string;
  at: number;
}

const file = () => path.join(app.getPath('userData'), 'chats.json');
const messagesFile = (id: string) => path.join(app.getPath('userData'), 'chats', `${id}.json`);

// The id names a file, so only plain ids may reach the disk (no '..', no slashes).
export function isChatId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

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
        (c.createdAt === undefined || typeof c.createdAt === 'number') &&
        (c.sessionId === undefined || typeof c.sessionId === 'string') &&
        (c.mode === undefined || c.mode === 'chat' || c.mode === 'code'),
    );
  } catch {
    return [];
  }
}

export function parseMessages(text: string): Message[] {
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (m): m is Message => !!m && (m.role === 'user' || m.role === 'claude') && typeof m.text === 'string' && typeof m.at === 'number',
    );
  } catch {
    return [];
  }
}

// Case-insensitive substring of the title or any message; an empty query matches every chat.
export function matches(chat: Chat, msgs: Message[], query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || chat.title.toLowerCase().includes(q) || msgs.some((m) => m.text.toLowerCase().includes(q));
}

export function makeTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 39) + '…' : t;
}

// The title comes from the first message only; later messages just bump updatedAt.
export function upsert(chats: Chat[], id: string, text: string, now: number): Chat[] {
  const old = chats.find((c) => c.id === id);
  const next: Chat = { mode: 'chat', createdAt: now, ...old, id, title: old?.title ?? makeTitle(text), updatedAt: now };
  return [next, ...chats.filter((c) => c.id !== id)];
}

export function setSession(chats: Chat[], id: string, sessionId: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, sessionId } : c));
}

// An empty title (only spaces) keeps the old one.
export function rename(chats: Chat[], id: string, title: string): Chat[] {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 100);
  return t ? chats.map((c) => (c.id === id ? { ...c, title: t } : c)) : chats;
}

// Where Claude Code keeps a session's transcript: its folder name is the cwd with every
// non-alphanumeric character turned into '-' (checked against claude 2.1). Only a uuid may name a file.
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return undefined;
  return path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
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

export function loadMessages(id: string): Message[] {
  try {
    return parseMessages(fs.readFileSync(messagesFile(id), 'utf8'));
  } catch {
    return [];
  }
}

// Async for search, which reads every chat file and must not block the main process.
export const readMessages = (id: string): Promise<Message[]> => fs.promises.readFile(messagesFile(id), 'utf8').then(parseMessages, () => []);

// Temp file + rename, as in settings.ts, so a crash can't leave half a file.
// A failed write is logged, not thrown: every save rewrites the whole file, so the next one repairs it.
function writeAtomic(target: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error(`Could not save ${target}:`, err);
  }
}

export const deleteMessages = (id: string): void => fs.rmSync(messagesFile(id), { force: true });
export const saveChats = (chats: Chat[]): void => writeAtomic(file(), chats);
export const saveMessages = (id: string, msgs: Message[]): void => writeAtomic(messagesFile(id), msgs);
