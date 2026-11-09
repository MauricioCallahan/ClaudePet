import { contextBridge, ipcRenderer } from 'electron';

// Expose narrow callbacks only, never ipcRenderer itself.
contextBridge.exposeInMainWorld('pet', {
  onNewChat: (cb: () => void): void => {
    ipcRenderer.on('chat:new', () => cb());
  },
  onOpenChat: (cb: (id: string) => void): void => {
    ipcRenderer.on('chat:open', (_e, id: string) => cb(id));
  },
  onFocusInput: (cb: () => void): void => {
    ipcRenderer.on('chat:focus', () => cb());
  },
  sendMessage: (chatId: string, text: string): void => {
    ipcRenderer.send('chat:message', chatId, text);
  },
  stopReply: (): void => {
    ipcRenderer.send('chat:stop');
  },
  // Reply lifecycle: start, then any number of chunks, then end or error.
  onReplyStart: (cb: () => void): void => {
    ipcRenderer.on('reply:start', () => cb());
  },
  onReplyChunk: (cb: (text: string) => void): void => {
    ipcRenderer.on('reply:chunk', (_e, text: string) => cb(text));
  },
  onReplyEnd: (cb: () => void): void => {
    ipcRenderer.on('reply:end', () => cb());
  },
  onReplyError: (cb: (message: string) => void): void => {
    ipcRenderer.on('reply:error', (_e, message: string) => cb(message));
  },
});
