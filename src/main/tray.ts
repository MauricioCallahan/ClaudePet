import { app, Menu, Tray } from 'electron';
import path from 'node:path';
import type { Chat } from './chats';

export interface TrayActions {
  toggle(): void;
  isVisible(): boolean;
  isThinking(): boolean;
  newChat(): void;
  recent(): Chat[];
  openChat(id: string): void;
}

// Module-level so the Tray is not garbage-collected (the icon would vanish).
let tray: Tray | null = null;
let actions: TrayActions;

// Rebuild whenever state the menu shows changes (window visibility, chat list).
export function refreshTray(): void {
  const chats = actions.recent();
  // Hidden while a reply is running: the tooltip is the only sign that something is happening.
  tray?.setToolTip(actions.isThinking() && !actions.isVisible() ? 'Chats: thinking…' : 'Chats');
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: actions.isVisible() ? 'Hide' : 'Show', click: actions.toggle },
      { label: 'New chat', click: actions.newChat },
      {
        label: 'Recent chats',
        submenu: chats.length
          ? chats.map((c) => ({
              // '&' marks an accelerator in Windows menus; double it to show a literal one.
              label: c.title.replace(/&/g, '&&'),
              click: () => actions.openChat(c.id),
            }))
          : [{ label: 'No recent chats', enabled: false }],
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

export function notify(title: string, content: string): void {
  tray?.displayBalloon({ title, content });
}

// Without this the icon can linger in the notification area after exit.
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

export function createTray(a: TrayActions): void {
  actions = a;
  tray = new Tray(path.join(__dirname, '../../assets/tray.ico'));
  tray.on('click', a.toggle);
  refreshTray();
}
