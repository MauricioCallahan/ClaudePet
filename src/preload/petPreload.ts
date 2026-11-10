import { contextBridge, ipcRenderer } from 'electron';

// The pet page gets only this, none of the chat API.
contextBridge.exposeInMainWorld('petWindow', {
  click: (): void => ipcRenderer.send('pet:click'),
  onSheet: (cb: (s: unknown) => void): void => void ipcRenderer.on('pet:sheet', (_e, s) => cb(s)),
  onPlay: (cb: (p: unknown) => void): void => void ipcRenderer.on('pet:play', (_e, p) => cb(p)),
});
