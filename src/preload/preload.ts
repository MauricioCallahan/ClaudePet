import { contextBridge, ipcRenderer } from 'electron';

// Expose narrow callbacks only, never ipcRenderer itself.
contextBridge.exposeInMainWorld('pet', {
  onNewChat: (cb: () => void): void => {
    ipcRenderer.on('chat:new', () => cb());
  },
});
