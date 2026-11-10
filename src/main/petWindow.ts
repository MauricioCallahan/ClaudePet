import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { petPosition, roomForPet } from './bounds';
import { COLUMNS, ROWS, type Pet } from './petFormat';

const SIZE = { width: 96, height: 104 }; // half a 192x208 sprite frame; a size setting comes in v0.2

// Module-level, like the tray, so main only has to call createPet once.
let pet: BrowserWindow | null = null;
let sprite: Pet | undefined;
let shown = true; // pet.enabled: "Hide pet" in the tray turns it off
let owner: BrowserWindow | null = null; // the chat box the pet stands on
let ready = false; // the pet page has loaded and can take a sheet

function place(box: BrowserWindow): void {
  const b = box.getBounds();
  pet?.setBounds({ ...petPosition(b, SIZE, screen.getDisplayMatching(b).workArea), ...SIZE });
}

// Only once a drag or resize ends: moving the box inside Windows' drag loop makes it jitter.
// Runs before main's debounced save, so the saved spot is the snapped one.
function makeRoom(box: BrowserWindow): void {
  const b = box.getBounds();
  const r = roomForPet(b, SIZE.height, screen.getDisplayMatching(b).workArea);
  if (r.y !== b.y) box.setBounds(r);
}

// A window of its own: the box would have to be transparent to hold the pet, and Windows can't resize transparent windows.
// shortcut: the whole 96x104 rectangle takes clicks, even transparent pixels; add setIgnoreMouseEvents hit-testing if it gets in the way
// Without a valid pet the window keeps the placeholder picture. A disabled pet's window exists but stays hidden.
export function createPet(box: BrowserWindow, onClick: () => void, chosen: Pet | undefined, enabled: boolean): void {
  sprite = chosen;
  shown = enabled;
  owner = box;
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
  pet.webContents.once('did-finish-load', () => {
    ready = true;
    setPet(sprite);
  });
  makeRoom(box); // a saved spot from before the pet existed may be too high
  place(box);
  box.on('move', () => place(box));
  box.on('resize', () => place(box));
  box.on('moved', () => makeRoom(box));
  box.on('resized', () => makeRoom(box));
  // The pet is shown and hidden with the box (Show/Hide, hotkey, ×), and never on its own.
  box.on('show', () => {
    place(box);
    if (shown) pet?.showInactive();
  });
  box.on('hide', () => pet?.hide());
  // Quit closes every window by itself, the pet included; this only drops the dead reference.
  pet.on('closed', () => (pet = null));
  pet.once('ready-to-show', () => {
    if (shown && box.isVisible()) pet?.showInactive();
  });
  ipcMain.on('pet:click', (e) => {
    if (e.sender === pet?.webContents) onClick();
  });
}

// Swaps the sheet and starts on idle; before the page has loaded, its load handler does it.
export function setPet(p: Pet | undefined): void {
  sprite = p;
  if (!p || !pet || !ready) return;
  pet.webContents.send('pet:sheet', { url: pathToFileURL(p.sheetPath).href, columns: COLUMNS, rows: p.rows });
  playRow(0);
}

// The pet still only shows while the box does.
export function setPetEnabled(on: boolean): void {
  shown = on;
  if (on && owner?.isVisible()) {
    place(owner);
    pet?.showInactive();
  } else pet?.hide();
}

// Plays one row of the sheet (0 = idle, see ROWS); a row the sheet doesn't have plays idle instead.
export function playRow(row: number): void {
  if (!sprite || !pet) return;
  const r = row < sprite.rows && ROWS[row] ? row : 0;
  pet.webContents.send('pet:play', { row: r, durations: ROWS[r].durations, loop: ROWS[r].loop });
}
