const messages = document.getElementById('messages')!;
const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('input') as HTMLTextAreaElement;

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
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';
});

// Enter sends, Shift+Enter inserts a newline.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// shortcut: close quits the app; becomes hide-to-tray in task 2.1
document.getElementById('close')!.addEventListener('click', () => window.close());

addMessage("Hi, I'm ClaudePet.", 'claude');
