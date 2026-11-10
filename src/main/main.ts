import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { deleteMessages, isChatId, loadChats, loadMessages, matches, readMessages, recent, rename, saveChats, saveMessages, setSession, transcriptPath, upsert, type Chat } from './chats';
import fs from 'node:fs';
import os from 'node:os';
import { FakeBridge, type Bridge } from './bridge';
import { ClaudeBridge, findClaude, readVersion } from './claudeBridge';
import { BridgeError, logLine, type ReplyError } from './errors';
import { fitPosition } from './bounds';
import { isWebUrl } from './links';
import { loadSettings, saveSettings } from './settings';
import { createTray, destroyTray, notify, refreshTray } from './tray';

let win: BrowserWindow | null = null;
let isQuitting = false;
const MAX_MESSAGE_LENGTH = 10_000;

function createWindow(): void {
  const size = { width: 360, height: 480 };
  const { x, y } = loadSettings();
  const pos =
    typeof x === 'number' && typeof y === 'number'
      ? fitPosition(
          { x, y },
          size,
          screen.getAllDisplays().map((d) => d.workArea),
          screen.getPrimaryDisplay().workArea,
        )
      : {};
  win = new BrowserWindow({
    ...pos,
    ...size,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minWidth: 280,
    minHeight: 320,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Links in replies open in the default browser, never inside the box.
  const openWeb = (url: string) => {
    if (isWebUrl(url)) void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openWeb(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openWeb(url);
  });

  // Save the position once a drag settles, not on every pixel.
  const w = win;
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    const [px, py] = w.getPosition();
    saveSettings({ x: px, y: py });
  };
  w.on('moved', () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  });
  w.on('close', (e) => {
    // × hides to the tray; only a real quit lets the window close.
    if (!isQuitting) {
      e.preventDefault();
      w.hide();
      return;
    }
    if (timer) {
      clearTimeout(timer);
      save();
    }
  });
  w.on('closed', () => (win = null));
  w.on('show', refreshTray);
  w.on('hide', refreshTray);
}

// focus() alone does nothing while the window is hidden in the tray, so show first.
function showWindow(): void {
  win?.show();
  win?.focus();
  win?.webContents.send('chat:focus');
}

function showAndSend(channel: string, ...args: unknown[]): void {
  if (!win) return;
  showWindow();
  win.webContents.send(channel, ...args);
}

let chats: Chat[] = [];

const workspace = path.join(app.getPath('userData'), 'workspace'); // the cwd of every claude process
const claudePath = () => findClaude(process.env, fs.existsSync, os.homedir());
// CLAUDEPET_BRIDGE=fake keeps the echo bridge for e2e tests and UI work without spending usage.
const bridge: Bridge =
  process.env.CLAUDEPET_BRIDGE === 'fake'
    ? new FakeBridge()
    : new ClaudeBridge({
        exe: claudePath,
        cwd: workspace,
        sessions: {
          get: (id) => chats.find((c) => c.id === id)?.sessionId,
          set: (id, sessionId) => {
            if (chats.find((c) => c.id === id)?.sessionId === sessionId) return; // every reply repeats it
            chats = setSession(chats, id, sessionId);
            saveChats(chats);
          },
        },
        mode: (id) => chats.find((c) => c.id === id)?.mode ?? 'chat',
        model: () => loadSettings().model,
        instructions: () => {
          try {
            return fs.readFileSync(path.join(app.getPath('userData'), 'instructions.md'), 'utf8');
          } catch (err) {
            // No file means no custom instructions; any other error (locked, a folder) ends the reply with its message.
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw new Error(`Could not read your instructions.md: ${(err as Error).message}`);
          }
        },
        promptFile: path.join(app.getPath('userData'), 'system-prompt.md'),
        // Long, because Code mode (v0.3) runs tools that print nothing for minutes; e2e sets it short.
        idleMs: Number(process.env.CLAUDEPET_IDLE_MS) || 15 * 60_000,
      });
let inflight: AbortController | null = null;
let replyChat = ''; // the chat the running reply belongs to
let running: Promise<void> = Promise.resolve(); // the current runReply, so a reopen can wait for its save

// shortcut: bridge.log grows without limit (errors only, so slowly); rotate it if it ever gets big
function logError(e: BridgeError): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'bridge.log'), logLine(new Date(), e.info.case, e.code, e.detail));
  } catch {
    // a log that cannot be written must never break the reply
  }
}

// Streams one reply to the renderer as reply:start, reply:chunk..., then reply:end or reply:error.
async function runReply(id: string, text: string): Promise<void> {
  const ac = new AbortController();
  inflight = ac;
  replyChat = id;
  refreshTray();
  const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args);
  send('reply:start');
  let reply = '';
  try {
    for await (const chunk of bridge.send(id, text, ac.signal)) {
      reply += chunk;
      send('reply:chunk', chunk);
    }
    send('reply:end');
  } catch (err) {
    // Stop and New chat abort on purpose: that is an ordinary end, not an error.
    if (ac.signal.aborted) send('reply:end');
    else {
      const e = err instanceof BridgeError ? err : new BridgeError({ case: 'unknown', message: err instanceof Error ? err.message : String(err) });
      send('reply:error', e.info);
      logError(e);
    }
  } finally {
    // Keep what streamed, even when Stop or an error cut it short; a chat deleted meanwhile stays deleted.
    if (reply && chats.some((c) => c.id === id)) saveMessages(id, [...loadMessages(id), { role: 'claude', text: reply, at: Date.now() }]);
    inflight = null;
    refreshTray();
  }
}

// Shared by the tray's Recent chats and the chat list. Switching chats ends the running reply,
// and waits for it to be saved, so a reopened chat shows it and it cannot stream into the wrong chat.
async function openChat(id: string): Promise<void> {
  inflight?.abort();
  await running;
  showAndSend('chat:open', id);
}

// Removes the chat everywhere: the index, its messages, the tray, the box, and Claude Code's own transcript.
async function deleteChat(id: string): Promise<void> {
  // Only this chat's own reply is stopped and waited for (its save must not bring the messages back).
  if (inflight && replyChat === id) {
    inflight.abort();
    await running;
  }
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;
  chats = chats.filter((c) => c !== chat);
  saveChats(chats);
  refreshTray();
  win?.webContents.send('chat:deleted', id);
  try {
    deleteMessages(id);
    const transcript = chat.sessionId && transcriptPath(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), workspace, chat.sessionId);
    if (transcript) {
      fs.rmSync(transcript, { force: true });
      fs.rmSync(transcript.slice(0, -'.jsonl'.length), { recursive: true, force: true }); // the session's side folder, if any
    }
  } catch (err) {
    console.error(`Could not delete the files of chat ${id}:`, err);
  }
}

// Shared by the tray and (Bullet 3) the global hotkey.
export function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

const DEFAULT_HOTKEY = 'CommandOrControl+,';
let hotkey = '';

// Swap the global shortcut; the v0.2 settings panel only needs to call this and saveSettings.
export function registerHotkey(accel: string): boolean {
  if (accel === hotkey) return true;
  let ok = false;
  try {
    // Visible but behind another app: bring it forward instead of hiding it.
    ok = globalShortcut.register(accel, () => {
      if (win?.isVisible() && !win.isFocused()) showWindow();
      else toggleWindow();
    });
  } catch {
    // register() throws on a malformed accelerator in settings.json
  }
  if (ok) {
    // Only drop the old key once the new one works, so a failed change keeps the old hotkey.
    if (hotkey) globalShortcut.unregister(hotkey);
    hotkey = accel;
  } else {
    console.error(`Could not register ${accel}: invalid or used by another app`);
    notify('Hotkey unavailable', `${accel} is invalid or used by another app. Use the tray icon to open ClaudePet.`);
  }
  return ok;
}

// Only one pet at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    const claude = claudePath();
    if (!claude) console.log('Claude Code: not installed');
    else void readVersion(claude).then((v) => console.log(`Claude Code: ${claude} (${v ?? 'unknown version'})`));
    chats = loadChats();
    // The renderer is untrusted input: check types and cap sizes before storing.
    ipcMain.on('chat:message', (_e, id: unknown, text: unknown, retry: unknown) => {
      if (!isChatId(id) || typeof text !== 'string') return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        // The renderer is already waiting on a reply; without this it would stay on Stop forever.
        const error: ReplyError = { case: 'unknown', message: `Message too long (max ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters).` };
        win?.webContents.send('reply:error', error);
        return;
      }
      if (inflight) return; // one reply at a time; the renderer swaps Send for Stop
      const now = Date.now();
      chats = upsert(chats, id, text, now);
      saveChats(chats);
      if (retry !== true) saveMessages(id, [...loadMessages(id), { role: 'user', text, at: now }]); // a Retry's message is already stored
      refreshTray();
      running = runReply(id, text);
    });
    ipcMain.on('clipboard:write', (_e, text: unknown) => {
      if (typeof text === 'string' && text.length <= 1_000_000) clipboard.writeText(text);
    });
    ipcMain.on('chat:stop', () => inflight?.abort());
    ipcMain.on('chat:open', (_e, id: unknown) => {
      if (isChatId(id)) void openChat(id);
    });
    ipcMain.on('chat:rename', (_e, id: unknown, title: unknown) => {
      if (!isChatId(id) || typeof title !== 'string') return;
      chats = rename(chats, id, title);
      saveChats(chats);
      refreshTray();
    });
    ipcMain.on('chat:delete', (_e, id: unknown) => {
      if (isChatId(id)) void deleteChat(id);
    });
    ipcMain.handle('chat:load', (_e, id: unknown) => (isChatId(id) ? loadMessages(id) : []));
    ipcMain.handle('chats:list', async (_e, query: unknown) => {
      const q = typeof query === 'string' ? query.slice(0, 200) : '';
      const all = recent(chats, Infinity);
      // shortcut: reads every chat file on each search; keep messages in memory if the list gets slow
      const hits = q.trim() ? (await Promise.all(all.map(async (c) => matches(c, await readMessages(c.id), q)))).flatMap((ok, i) => (ok ? [all[i]] : [])) : all;
      return hits.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    });
    createWindow();
    createTray({
      toggle: toggleWindow,
      isVisible: () => !!win?.isVisible(),
      isThinking: () => !!inflight,
      // Switching chats ends the running reply so it cannot stream into the wrong chat.
      newChat: () => {
        inflight?.abort();
        showAndSend('chat:new');
      },
      recent: () => recent(chats),
      openChat: (id) => void openChat(id),
    });
    const { hotkey: saved } = loadSettings();
    registerHotkey(typeof saved === 'string' && saved ? saved : DEFAULT_HOTKEY);
  });
  // Covers every quit path (tray menu, Windows shutdown), not just our own menu item.
  app.on('before-quit', () => {
    isQuitting = true;
    inflight?.abort(); // kills a running claude process so none outlives the app
    destroyTray();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
