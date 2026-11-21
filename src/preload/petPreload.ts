import { contextBridge, ipcRenderer, webUtils } from 'electron';

// A file dropped on the page: preventDefault stops the window from opening it, and only main gets the path.
// Done here because a File does not cross contextBridge, and getPathForFile needs the real one.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) ipcRenderer.send('pet:drop', webUtils.getPathForFile(file));
});

// The pet page gets only this, none of the chat API.
contextBridge.exposeInMainWorld('petWindow', {
  drag: (phase: 'start' | 'move' | 'end'): void => ipcRenderer.send('pet:drag', phase),
  onSheet: (cb: (s: unknown) => void): void => void ipcRenderer.on('pet:sheet', (_e, s) => cb(s)),
  onPlay: (cb: (p: unknown) => void): void => void ipcRenderer.on('pet:play', (_e, p) => cb(p)),
});
