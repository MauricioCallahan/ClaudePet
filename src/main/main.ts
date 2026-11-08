import { app, BrowserWindow } from 'electron';
import path from 'node:path';

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
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
  win.on('closed', () => (win = null));
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
