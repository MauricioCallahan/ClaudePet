import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { petPosition } from './bounds';

const SIZE = { width: 96, height: 104 }; // half a 192x208 sprite frame; a size setting comes in v0.2

// Module-level, like the tray, so main only has to call createPet once.
let pet: BrowserWindow | null = null;

function place(box: BrowserWindow): void {
  const b = box.getBounds();
  pet?.setBounds({ ...petPosition(b, SIZE, screen.getDisplayMatching(b).workArea), ...SIZE });
}

// A window of its own: the box would have to be transparent to hold the pet, and Windows can't resize transparent windows.
export function createPet(box: BrowserWindow): void {
  pet = new BrowserWindow({
    ...SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // a click on the pet must leave the focus in the chat input
    webPreferences: {
      preload: path.join(__dirname, '../preload/petPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pet.loadFile(path.join(__dirname, '../renderer/pet.html'));
  place(box);
  pet.once('ready-to-show', () => {
    if (box.isVisible()) pet?.showInactive();
  });
}
