import { Tray } from 'electron';
import path from 'node:path';

// Module-level so the Tray is not garbage-collected (the icon would vanish).
let tray: Tray | null = null;

export function createTray(): Tray {
  tray = new Tray(path.join(__dirname, '../../assets/tray.ico'));
  tray.setToolTip('Chats');
  return tray;
}
