import { contextBridge, ipcRenderer } from 'electron';

// Expose narrow callbacks only, never ipcRenderer itself.
contextBridge.exposeInMainWorld('pet', {
  onNewChat: (cb: () => void): void => {
    ipcRenderer.on('chat:new', () => cb());
  },
  onOpenChat: (cb: (id: string) => void): void => {
    ipcRenderer.on('chat:open', (_e, id: string) => cb(id));
  },
  sendMessage: (chatId: string, text: string): void => {
    ipcRenderer.send('chat:message', chatId, text);
  },
});
