import { contextBridge, ipcRenderer } from 'electron';

// The picker page gets only this, none of the chat API.
contextBridge.exposeInMainWorld('picker', {
  list: (): Promise<unknown> => ipcRenderer.invoke('picker:list'),
  choose: (id: string): void => ipcRenderer.send('picker:choose', id),
  onChanged: (cb: () => void): void => void ipcRenderer.on('picker:changed', () => cb()),
});
