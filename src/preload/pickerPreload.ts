import { contextBridge, ipcRenderer, webUtils } from 'electron';

// A file dropped on the page: preventDefault stops the window from opening it, and only main gets the path.
// Done here because a File does not cross contextBridge, and getPathForFile needs the real one.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) ipcRenderer.send('picker:drop', webUtils.getPathForFile(file));
});

// The picker page gets only this, none of the chat API.
contextBridge.exposeInMainWorld('picker', {
  list: (): Promise<unknown> => ipcRenderer.invoke('picker:list'),
  choose: (id: string): void => ipcRenderer.send('picker:choose', id),
  install: (): void => ipcRenderer.send('picker:install'),
  onChanged: (cb: () => void): void => void ipcRenderer.on('picker:changed', () => cb()),
});
