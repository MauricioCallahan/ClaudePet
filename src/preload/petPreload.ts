import { contextBridge, ipcRenderer } from 'electron';

// The pet page gets only this, none of the chat API.
contextBridge.exposeInMainWorld('petWindow', {
  click: (): void => ipcRenderer.send('pet:click'),
});
