import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings } from './settings';

let win: BrowserWindow | null = null;

function createWindow(): void {
  const { x, y } = loadSettings();
  const hasPosition = typeof x === 'number' && typeof y === 'number';
  win = new BrowserWindow({
    ...(hasPosition ? { x, y } : {}),
    width: 360,
    height: 480,
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
  w.on('close', () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  });
  w.on('closed', () => (win = null));
}

// Only one pet at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.focus());
  app.whenReady().then(createWindow);
  // shortcut: quit on close, replace with hide-to-tray in task 2.1
  app.on('window-all-closed', () => app.quit());
}
