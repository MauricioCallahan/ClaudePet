import { Menu, Tray } from 'electron';
import path from 'node:path';

export interface TrayActions {
  toggle(): void;
  isVisible(): boolean;
}

// Module-level so the Tray is not garbage-collected (the icon would vanish).
let tray: Tray | null = null;
let actions: TrayActions;

// Rebuild whenever state the menu shows changes (window visibility, later the chat list).
export function refreshTray(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([{ label: actions.isVisible() ? 'Hide' : 'Show', click: actions.toggle }]),
  );
}

export function createTray(a: TrayActions): void {
  actions = a;
  tray = new Tray(path.join(__dirname, '../../assets/tray.ico'));
  tray.setToolTip('Chats');
  tray.on('click', a.toggle);
  refreshTray();
}
