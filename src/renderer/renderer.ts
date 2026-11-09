const messages = document.getElementById('messages')!;
const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const thinking = document.getElementById('thinking')!;
const sendButton = document.getElementById('send')!;
let chatId: string = crypto.randomUUID();

// The UI is drawn from this one value; call setState instead of toggling elements.
type State = 'idle' | 'thinking' | 'error';
let state: State = 'idle';
function setState(s: State): void {
  state = s;
  thinking.hidden = s !== 'thinking';
  sendButton.textContent = s === 'thinking' ? 'Stop' : 'Send';
}

// textContent, never innerHTML: replies in Milestone 2 are untrusted text.
function addMessage(text: string, who: 'user' | 'claude'): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state === 'thinking') {
    pet.stopReply(); // the button reads Stop while a reply is running
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  pet.sendMessage(chatId, text);
  input.value = '';
  setState('thinking'); // main answers with reply:start/chunk/end
});

// Enter sends, Shift+Enter inserts a newline.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state !== 'thinking') form.requestSubmit(); // Enter must not act as Stop
  }
});

// The main process turns close into hide-to-tray.
document.getElementById('close')!.addEventListener('click', () => window.close());

// Provided by the preload script.
declare const pet: {
  onNewChat(cb: () => void): void;
  onOpenChat(cb: (id: string) => void): void;
  onFocusInput(cb: () => void): void;
  sendMessage(chatId: string, text: string): void;
  stopReply(): void;
  onReplyStart(cb: () => void): void;
  onReplyChunk(cb: (text: string) => void): void;
  onReplyEnd(cb: () => void): void;
  onReplyError(cb: (message: string) => void): void;
};

// The reply bubble grows as chunks arrive.
let reply: HTMLElement | null = null;
pet.onReplyStart(() => {
  setState('thinking');
  reply = addMessage('', 'claude');
});
pet.onReplyChunk((text) => {
  if (!reply) return;
  reply.textContent += text;
  messages.scrollTop = messages.scrollHeight;
});
pet.onReplyEnd(() => {
  reply = null;
  setState('idle');
});
pet.onReplyError((message) => {
  reply?.remove();
  reply = null;
  addMessage(message, 'claude');
  setState('error');
});

// shortcut: reopening a chat switches the id but cannot restore messages, until M2 stores history
function resetChat(id: string): void {
  chatId = id;
  reply = null; // a reply cut off by New chat must not write into the new chat
  setState('idle');
  messages.replaceChildren();
  addMessage("Hi, I'm ClaudePet.", 'claude');
  input.value = '';
  input.focus();
}
pet.onNewChat(() => resetChat(crypto.randomUUID()));
pet.onOpenChat(resetChat);
pet.onFocusInput(() => input.focus());
resetChat(chatId);
