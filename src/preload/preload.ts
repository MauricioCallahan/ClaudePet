import { contextBridge, ipcRenderer } from 'electron';

type ReplyError = { message: string; link?: string; retry?: boolean };

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
  listChats: (): Promise<{ id: string; title: string; updatedAt: number }[]> => ipcRenderer.invoke('chats:list'),
  openChat: (id: string): void => {
    ipcRenderer.send('chat:open', id);
  },
  loadChat: (id: string): Promise<{ role: 'user' | 'claude'; text: string; at: number }[]> => ipcRenderer.invoke('chat:load', id),
  stopReply: (): void => {
    ipcRenderer.send('chat:stop');
  },
  copyText: (text: string): void => {
    // Via main: navigator.clipboard needs focus and a secure context, and Electron's sandboxed preload has no clipboard.
    ipcRenderer.send('clipboard:write', text);
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
  onReplyError: (cb: (error: ReplyError) => void): void => {
    ipcRenderer.on('reply:error', (_e, error: ReplyError) => cb(error));
  },
});
