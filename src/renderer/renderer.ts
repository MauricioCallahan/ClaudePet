const messages = document.getElementById('messages')!;
const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const thinking = document.getElementById('thinking')!;
let chatId: string = crypto.randomUUID();

// The UI is drawn from this one value; call setState instead of toggling elements.
type State = 'idle' | 'thinking' | 'error';
let state: State = 'idle';
function setState(s: State): void {
  state = s;
  thinking.hidden = s !== 'thinking';
}

// textContent, never innerHTML: replies in Milestone 2 are untrusted text.
function addMessage(text: string, who: 'user' | 'claude'): void {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state === 'thinking') return;
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  pet.sendMessage(chatId, text);
  input.value = '';
  setState('thinking'); // until replies arrive (4.2), nothing clears this but a new chat
});

// Enter sends, Shift+Enter inserts a newline.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
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
};

// shortcut: reopening a chat switches the id but cannot restore messages, until M2 stores history
function resetChat(id: string): void {
  chatId = id;
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
