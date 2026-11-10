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
let lastText = ''; // what Retry sends again

// The UI is drawn from this one value; call setState instead of toggling elements.
type State = 'idle' | 'thinking' | 'error';
let state: State = 'idle';
const THINKING = 'thinking…';
const SLOW_MS = 60_000;
let slow = 0;
// Restarted by every chunk, so the note only shows while the reply is visibly stuck.
function armSlow(): void {
  clearTimeout(slow);
  if (thinking.textContent !== THINKING) thinking.textContent = THINKING; // unchanged text must not be re-announced
  slow = window.setTimeout(() => (thinking.textContent = 'Still working, this one is taking a while…'), SLOW_MS);
}
function setState(s: State): void {
  state = s;
  clearTimeout(slow);
  // Stays in the page and only its text changes: screen readers announce text changes in a live region, not unhiding.
  if (s === 'thinking') armSlow();
  else thinking.textContent = '';
  sendButton.textContent = s === 'thinking' ? 'Stop' : 'Send';
}

// User and error text goes in with textContent; Claude's replies are untrusted Markdown, rendered only through renderMarkdown (sanitized).
function addMessage(text: string, who: 'user' | 'claude', scroll = true, at = Date.now()): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  el.title = new Date(at).toLocaleTimeString(); // hover shows when it was sent
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
  send(text);
  input.value = '';
});

function send(text: string): void {
  messages.querySelectorAll('button.retry').forEach((b) => b.remove()); // only the latest error can be retried
  lastText = text;
  pet.sendMessage(chatId, text);
  setState('thinking'); // main answers with reply:start/chunk/end
}

// Enter sends, Shift+Enter inserts a newline.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state !== 'thinking') form.requestSubmit(); // Enter must not act as Stop
  }
});

// The main process turns close into hide-to-tray.
document.getElementById('close')!.addEventListener('click', () => window.close());

// Sent by main on reply:error; link opens in the browser (via will-navigate), retry resends the last message.
type ReplyError = { message: string; link?: string; retry?: boolean };

type ChatSummary = { id: string; title: string; updatedAt: number };
type Message = { role: 'user' | 'claude'; text: string; at: number };

// Provided by the preload script.
declare const pet: {
  onNewChat(cb: () => void): void;
  onOpenChat(cb: (id: string) => void): void;
  onFocusInput(cb: () => void): void;
  sendMessage(chatId: string, text: string): void;
  listChats(): Promise<ChatSummary[]>;
  openChat(id: string): void;
  loadChat(id: string): Promise<Message[]>;
  stopReply(): void;
  copyText(text: string): void;
  onReplyStart(cb: () => void): void;
  onReplyChunk(cb: (text: string) => void): void;
  onReplyEnd(cb: () => void): void;
  onReplyError(cb: (error: ReplyError) => void): void;
};

// One listener for every Copy button, including ones created by later renders.
messages.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button.retry')) {
    send(lastText); // no new user bubble: the message is already on screen
    return;
  }
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
  reply ||= addReply(); // created on the first word, so no empty bubble while waiting
  // shortcut: re-parses the whole reply each frame, quadratic for very long replies; stream-parse if that shows up
  renderReply(reply, (rawText.get(reply) ?? '') + pending);
  pending = '';
  if (stick) messages.scrollTop = messages.scrollHeight;
}
// A reply bubble: the body is re-rendered as text streams in; the Copy reply button stays.
function addReply(at?: number): HTMLElement {
  const el = addMessage('', 'claude', false, at);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-reply';
  button.textContent = 'Copy reply';
  el.append(document.createElement('div'), button);
  return el;
}
function renderReply(el: HTMLElement, raw: string): void {
  rawText.set(el, raw);
  const body = el.firstElementChild as HTMLElement;
  body.innerHTML = renderMarkdown(raw, purify);
  addCopyButtons(body);
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
  if (state === 'thinking') armSlow();
  frame ||= requestAnimationFrame(flush);
});
pet.onReplyEnd(() => {
  flush();
  reply = null;
  setState('idle');
});
pet.onReplyError((error) => {
  flush();
  reply = null;
  const el = addMessage(error.message, 'claude');
  if (error.link) {
    const a = document.createElement('a');
    a.href = error.link;
    a.textContent = error.link;
    el.append(' ', a);
  }
  if (error.retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retry';
    button.textContent = 'Retry';
    el.append(' ', button);
  }
  setState('error');
});

// The chat list takes the place of the conversation while it is open.
const chatsButton = document.getElementById('chats-button')!;
const chatsPanel = document.getElementById('chats')!;
const chatList = document.getElementById('chat-list')!;
async function showList(open: boolean): Promise<void> {
  chatsPanel.hidden = !open;
  messages.hidden = form.hidden = thinking.hidden = open;
  chatsButton.setAttribute('aria-expanded', String(open));
  if (!open) return input.focus();
  const rows = (await pet.listChats()).map((c) => {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'open';
    row.dataset.id = c.id;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = c.title; // titles come from user text: never innerHTML
    const time = document.createElement('time');
    time.dateTime = new Date(c.updatedAt).toISOString();
    time.textContent = new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    row.append(title, time);
    li.append(row);
    return li;
  });
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No chats yet.';
    rows.push(li);
  }
  chatList.replaceChildren(...rows);
  chatList.querySelector<HTMLElement>('button')?.focus();
}
// Opening goes through main, the same path as the tray's Recent chats.
chatList.addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('button.open');
  if (row?.dataset.id) pet.openChat(row.dataset.id);
});
chatsButton.addEventListener('click', () => void showList(chatsButton.getAttribute('aria-expanded') !== 'true'));
chatsPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void showList(false);
});

function resetChat(id: string, history: Message[] = []): void {
  chatId = id;
  dropReply(); // a reply cut off by New chat must not write into the new chat
  setState('idle');
  void showList(false);
  messages.replaceChildren();
  for (const m of history) {
    if (m.role === 'user') addMessage(m.text, 'user', false, m.at);
    else renderReply(addReply(m.at), m.text);
  }
  if (!history.length) addMessage("Hi, I'm ClaudePet.", 'claude');
  messages.scrollTop = messages.scrollHeight;
  input.value = '';
  input.focus();
}
pet.onNewChat(() => resetChat(crypto.randomUUID()));
pet.onOpenChat(async (id) => resetChat(id, await pet.loadChat(id)));
pet.onFocusInput(() => input.focus());
resetChat(chatId);
