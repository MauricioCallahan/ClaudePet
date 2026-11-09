import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fitPosition } from './bounds';
import { loadSettings, saveSettings } from './settings';
import { createTray, refreshTray } from './tray';

let win: BrowserWindow | null = null;
let isQuitting = false;

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

// Shared by the tray and (Bullet 3) the global hotkey.
export function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

// Only one pet at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.focus());
  app.whenReady().then(() => {
    createWindow();
    createTray({ toggle: toggleWindow, isVisible: () => !!win?.isVisible() });
  });
  app.on('before-quit', () => (isQuitting = true));
}
