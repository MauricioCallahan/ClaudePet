import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { loadChats, recent, saveChats, setSession, upsert, type Chat } from './chats';
import fs from 'node:fs';
import os from 'node:os';
import { FakeBridge, type Bridge } from './bridge';
import { ClaudeBridge, findClaude, readVersion } from './claudeBridge';
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

const claudePath = () => findClaude(process.env, fs.existsSync, os.homedir());
// CLAUDEPET_BRIDGE=fake keeps the echo bridge for e2e tests and UI work without spending usage.
const bridge: Bridge =
  process.env.CLAUDEPET_BRIDGE === 'fake'
    ? new FakeBridge()
    : new ClaudeBridge({
        exe: claudePath,
        cwd: path.join(app.getPath('userData'), 'workspace'),
        sessions: {
          get: (id) => chats.find((c) => c.id === id)?.sessionId,
          set: (id, sessionId) => {
            if (chats.find((c) => c.id === id)?.sessionId === sessionId) return; // every reply repeats it
            chats = setSession(chats, id, sessionId);
            saveChats(chats);
          },
        },
      });
let inflight: AbortController | null = null;

// Streams one reply to the renderer as reply:start, reply:chunk..., then reply:end or reply:error.
async function runReply(id: string, text: string): Promise<void> {
  const ac = new AbortController();
  inflight = ac;
  refreshTray();
  const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args);
  send('reply:start');
  try {
    for await (const chunk of bridge.send(id, text, ac.signal)) send('reply:chunk', chunk);
    send('reply:end');
  } catch (err) {
    // Stop and New chat abort on purpose: that is an ordinary end, not an error.
    if (ac.signal.aborted) send('reply:end');
    else send('reply:error', err instanceof Error ? err.message : String(err));
  } finally {
    inflight = null;
    refreshTray();
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
    ipcMain.on('chat:message', (_e, id: unknown, text: unknown) => {
      if (typeof id !== 'string' || typeof text !== 'string') return;
      if (id.length > 100) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        // The renderer is already waiting on a reply; without this it would stay on Stop forever.
        win?.webContents.send('reply:error', `Message too long (max ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters).`);
        return;
      }
      if (inflight) return; // one reply at a time; the renderer swaps Send for Stop
      chats = upsert(chats, id, text, Date.now());
      saveChats(chats);
      refreshTray();
      void runReply(id, text);
    });
    ipcMain.on('clipboard:write', (_e, text: unknown) => {
      if (typeof text === 'string' && text.length <= 1_000_000) clipboard.writeText(text);
    });
    ipcMain.on('chat:stop', () => inflight?.abort());
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
      openChat: (id) => {
        inflight?.abort();
        showAndSend('chat:open', id);
      },
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
