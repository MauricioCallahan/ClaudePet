import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';
import { loadChats, recent, saveChats, upsert, type Chat } from './chats';
import { fitPosition } from './bounds';
import { loadSettings, saveSettings } from './settings';
import { createTray, destroyTray, refreshTray } from './tray';

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
}

function showAndSend(channel: string, ...args: unknown[]): void {
  if (!win) return;
  showWindow();
  win.webContents.send(channel, ...args);
}

let chats: Chat[] = [];

// Shared by the tray and (Bullet 3) the global hotkey.
export function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

// Only one pet at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    chats = loadChats();
    // The renderer is untrusted input: check types and cap sizes before storing.
    ipcMain.on('chat:message', (_e, id: unknown, text: unknown) => {
      if (typeof id !== 'string' || typeof text !== 'string') return;
      if (id.length > 100 || text.length > MAX_MESSAGE_LENGTH) return;
      chats = upsert(chats, id, text, Date.now());
      saveChats(chats);
      refreshTray();
    });
    createWindow();
    createTray({
      toggle: toggleWindow,
      isVisible: () => !!win?.isVisible(),
      newChat: () => showAndSend('chat:new'),
      recent: () => recent(chats),
      openChat: (id) => showAndSend('chat:open', id),
    });
    globalShortcut.register('CommandOrControl+,', toggleWindow);
  });
  // Covers every quit path (tray menu, Windows shutdown), not just our own menu item.
  app.on('before-quit', () => {
    isQuitting = true;
    destroyTray();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
