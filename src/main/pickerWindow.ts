import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { isPetId } from './settings';

export interface PickerItem {
  id: string;
  displayName: string;
  url: string; // file URL of the sprite sheet; the preview is its top-left cell
  columns: number;
  rows: number;
  chosen: boolean;
}

// One picker at a time, module-level like the pet window.
let picker: BrowserWindow | null = null;

// Called once at startup. Only the picker page may list or choose, and only a valid id gets through.
export function initPicker(a: { list(): PickerItem[]; choose(id: string): void }): void {
  ipcMain.handle('picker:list', (e) => (e.sender === picker?.webContents ? a.list() : []));
  ipcMain.on('picker:choose', (e, id: unknown) => {
    if (e.sender === picker?.webContents && isPetId(id)) a.choose(id);
  });
}

export function openPicker(): void {
  if (picker) return picker.focus();
  picker = new BrowserWindow({
    width: 480,
    height: 420,
    title: 'Choose a pet',
    icon: path.join(__dirname, '../../assets/tray.ico'),
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true, // the box and pet are always on top; the picker must not open behind them
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/pickerPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  picker.loadFile(path.join(__dirname, '../renderer/picker.html'));
  picker.once('ready-to-show', () => picker?.show());
  picker.webContents.on('will-navigate', (e) => e.preventDefault()); // a file dropped on the window would replace the page
  picker.on('closed', () => (picker = null));
}

// The list or the choice changed: the open picker redraws.
export function pickerChanged(): void {
  picker?.webContents.send('picker:changed');
}
