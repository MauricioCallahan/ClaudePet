import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { petPosition, roomForPet } from './bounds';
import { COLUMNS, playableRow, ROWS, sheetUrl, type Pet } from './petFormat';

export const PET_SIZE = { width: 96, height: 104 }; // half a 192x208 sprite frame; a size setting comes in v0.2

// Module-level, like the tray, so main only has to call createPet once.
let pet: BrowserWindow | null = null;
let sprite: Pet | undefined;
let shown = true; // pet.enabled: "Hide pet" in the tray turns it off
let owner: BrowserWindow | null = null; // the chat box the pet stands on
let ready = false; // the pet page has loaded and can take a sheet
let current = 0; // the row the pet state wants (see STATE_ROW)

function place(box: BrowserWindow): void {
  const b = box.getBounds();
  pet?.setBounds({ ...petPosition(b, PET_SIZE, screen.getDisplayMatching(b).workArea), ...PET_SIZE });
}

// Only once a drag or resize ends: moving the box inside Windows' drag loop makes it jitter.
// Runs before main's debounced save, so the saved spot is the snapped one.
function makeRoom(box: BrowserWindow): void {
  const b = box.getBounds();
  const r = roomForPet(b, PET_SIZE.height, screen.getDisplayMatching(b).workArea);
  if (r.y !== b.y) box.setBounds(r);
}

// A window of its own: the box would have to be transparent to hold the pet, and Windows can't resize transparent windows.
// shortcut: the whole 96x104 rectangle takes clicks, even transparent pixels; add setIgnoreMouseEvents hit-testing if it gets in the way
// Without a valid pet the window keeps the placeholder picture. A disabled pet's window exists but stays hidden.
export function createPet(box: BrowserWindow, chosen: Pet | undefined, enabled: boolean, onDrop: (zipPath: string) => void, onDrag: (phase: unknown) => void): void {
  sprite = chosen;
  shown = enabled;
  owner = box;
  pet = new BrowserWindow({
    ...PET_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // dragging the pet must leave the focus in the chat input
    webPreferences: {
      preload: path.join(__dirname, '../preload/petPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pet.loadFile(path.join(__dirname, '../renderer/pet.html'));
  pet.webContents.on('will-navigate', (e) => e.preventDefault()); // a file dropped on the pet must not replace its page
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
  // Holding the pet drags the box it stands on (compact mode); place() then moves the pet with it.
  ipcMain.on('pet:drag', (e, phase: unknown) => {
    if (e.sender === pet?.webContents) onDrag(phase);
  });
  // A pet zip dropped on the pet; the window stays unfocusable.
  ipcMain.on('pet:drop', (e, zipPath: unknown) => {
    if (e.sender === pet?.webContents && typeof zipPath === 'string' && zipPath) onDrop(zipPath);
  });
}

// Swaps the sheet and replays the current state on it; before the page has loaded, its load handler does it.
export function setPet(p: Pet | undefined): void {
  sprite = p;
  if (!p || !pet || !ready) return;
  pet.webContents.send('pet:sheet', { url: sheetUrl(p), columns: COLUMNS, rows: p.rows });
  playRow(current);
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
// Kept even with no pet yet, so the state shows once the page loads or the pet is swapped.
export function playRow(row: number): void {
  current = row;
  if (!sprite || !pet || !ready) return;
  const r = playableRow(row, sprite.rows);
  pet.webContents.send('pet:play', { row: r, durations: ROWS[r].durations, loop: ROWS[r].loop });
}
