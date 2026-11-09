import DOMPurify from './vendor/purify.es.mjs';
import { addCopyButtons, codeToCopy } from './codeBlocks.js';
import { renderMarkdown } from './markdown.js';
import { shouldStick } from './scroll.js';

const purify = DOMPurify(window);

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
  // Stays in the page and only its text changes: screen readers announce text changes in a live region, not unhiding.
  thinking.textContent = s === 'thinking' ? 'thinking…' : '';
  sendButton.textContent = s === 'thinking' ? 'Stop' : 'Send';
}

// User and error text goes in with textContent; Claude's replies are untrusted Markdown, rendered only through renderMarkdown (sanitized).
function addMessage(text: string, who: 'user' | 'claude', scroll = true): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  el.title = new Date().toLocaleTimeString(); // hover shows when it was sent
  messages.appendChild(el);
  if (scroll) messages.scrollTop = messages.scrollHeight;
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
  copyText(text: string): void;
  onReplyStart(cb: () => void): void;
  onReplyChunk(cb: (text: string) => void): void;
  onReplyEnd(cb: () => void): void;
  onReplyError(cb: (message: string) => void): void;
};

// One listener for every Copy button, including ones created by later renders.
messages.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const whole = target.closest<HTMLElement>('button.copy-reply'); // copies the reply's Markdown source
  const code = whole ? rawText.get(whole.parentElement!) ?? '' : codeToCopy(target);
  if (code === null) return;
  pet.copyText(code);
  const button = target;
  button.textContent = 'Copied';
  const label = whole ? 'Copy reply' : 'Copy';
  setTimeout(() => (button.textContent = label), 1500);
});

// The reply bubble grows as chunks arrive.
let reply: HTMLElement | null = null;
const rawText = new WeakMap<HTMLElement, string>(); // the Markdown source of each reply bubble
let pending = ''; // chunks wait here so the DOM is written once per frame
let frame = 0;
function flush(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  if (!pending) return;
  // Decide before growing: follow the reply only if the reader is at the bottom.
  const stick = shouldStick(messages.scrollTop, messages.clientHeight, messages.scrollHeight);
  if (!reply) {
    // Created on the first word, so no empty bubble while waiting. The body is re-rendered; the button stays.
    reply = addMessage('', 'claude', false);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-reply';
    button.textContent = 'Copy reply';
    reply.append(document.createElement('div'), button);
  }
  const body = reply.firstElementChild as HTMLElement;
  // shortcut: re-parses the whole reply each frame, quadratic for very long replies; stream-parse if that shows up
  const raw = (rawText.get(reply) ?? '') + pending;
  rawText.set(reply, raw);
  body.innerHTML = renderMarkdown(raw, purify);
  addCopyButtons(body);
  pending = '';
  if (stick) messages.scrollTop = messages.scrollHeight;
}
function dropReply(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  pending = '';
  reply = null;
}
pet.onReplyStart(() => setState('thinking'));
pet.onReplyChunk((text) => {
  pending += text;
  frame ||= requestAnimationFrame(flush);
});
pet.onReplyEnd(() => {
  flush();
  reply = null;
  setState('idle');
});
pet.onReplyError((message) => {
  flush();
  reply = null;
  addMessage(message, 'claude');
  setState('error');
});

// shortcut: reopening a chat switches the id but cannot restore messages, until M2 stores history
function resetChat(id: string): void {
  chatId = id;
  dropReply(); // a reply cut off by New chat must not write into the new chat
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
