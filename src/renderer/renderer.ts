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
const bar = document.getElementById('bar')!; // holds the form; in compact mode also the pill, and it morphs
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
  sendButton.classList.toggle('stop', s === 'thinking'); // compact mode draws the button as an icon
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

function send(text: string, retry = false): void {
  messages.querySelectorAll('button.retry').forEach((b) => b.remove()); // only the latest error can be retried
  lastText = text;
  pet.sendMessage(chatId, text, retry);
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
  sendMessage(chatId: string, text: string, retry: boolean): void;
  listChats(query?: string): Promise<ChatSummary[]>;
  openChat(id: string): void;
  loadChat(id: string): Promise<Message[]>;
  renameChat(id: string, title: string): void;
  deleteChat(id: string): void;
  onChatDeleted(cb: (id: string) => void): void;
  stopReply(): void;
  copyText(text: string): void;
  onReplyStart(cb: () => void): void;
  onReplyChunk(cb: (text: string) => void): void;
  onReplyEnd(cb: () => void): void;
  onReplyError(cb: (error: ReplyError) => void): void;
  isCompact(): Promise<boolean>;
  fitBox(mode: Mode, height: number): void;
  setMouseInside(inside: boolean): void;
  dragBox(phase: 'start' | 'move' | 'end'): void;
  onCompose(cb: () => void): void;
};

// One listener for every Copy button, including ones created by later renders.
messages.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button.retry')) {
    send(lastText, true); // no new user bubble, and no second copy in the store: the message is already there
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
const search = document.getElementById('search') as HTMLInputElement;
async function showList(open: boolean): Promise<void> {
  chatsPanel.hidden = !open;
  messages.hidden = bar.hidden = thinking.hidden = open;
  chatsButton.setAttribute('aria-expanded', String(open));
  if (!open) return input.focus();
  search.value = '';
  search.focus();
  await renderList();
}
let listed = 0; // only the latest search may draw, even if an older one answers last
async function renderList(): Promise<void> {
  const ask = ++listed;
  const found = await pet.listChats(search.value);
  if (ask !== listed) return;
  const rows = found.map((c) => {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.dataset.title = c.title;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'open';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = c.title; // titles come from user text: never innerHTML
    const time = document.createElement('time');
    time.dateTime = new Date(c.updatedAt).toISOString();
    time.textContent = new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    row.append(title, time);
    li.append(row, button('rename', '✎', 'Rename'), button('delete', '🗑', 'Delete'));
    return li;
  });
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = search.value.trim() ? 'No matching chats.' : 'No chats yet.';
    rows.push(li);
  }
  chatList.replaceChildren(...rows);
}
let searchTimer = 0;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void renderList(), 150); // one search per pause in typing, not per key
});
function button(className: string, text: string, label = text): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  return b;
}
// Rename and delete swap the row's content in place; any re-render puts the normal row back.
// Opening goes through main, the same path as the tray's Recent chats.
chatList.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest('button')?.className;
  const li = (e.target as HTMLElement).closest('li');
  const id = li?.dataset.id;
  if (!li || !id) return;
  if (action === 'open') pet.openChat(id);
  else if (action === 'rename') {
    const field = document.createElement('input');
    field.className = 'rename-field';
    field.value = li.dataset.title ?? '';
    field.setAttribute('aria-label', 'New title');
    li.replaceChildren(field);
    field.select();
  } else if (action === 'delete') {
    const ask = document.createElement('span');
    ask.textContent = 'Delete this chat?';
    const no = button('no', 'No');
    li.replaceChildren(ask, button('yes', 'Yes'), no);
    no.focus(); // the safe answer is the default
  } else if (action === 'yes') pet.deleteChat(id); // main answers with chat:deleted
  else if (action === 'no') void renderList();
});
chatList.addEventListener('keydown', (e) => {
  const field = e.target as HTMLInputElement;
  if (!field.classList.contains('rename-field')) return;
  if (e.key === 'Enter') pet.renameChat(field.closest('li')!.dataset.id!, field.value);
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.stopPropagation(); // Esc cancels the rename, not the whole list
  void renderList();
});
chatsButton.addEventListener('click', () => void showList(chatsButton.getAttribute('aria-expanded') !== 'true'));
chatsPanel.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation(); // Esc closes the list only, it does not also collapse the compact box
  void showList(false);
  if (compact) setMode(listFrom);
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
pet.onChatDeleted((id) => {
  if (id === chatId) resetChat(crypto.randomUUID());
  else if (!chatsPanel.hidden) void renderList();
});

// Compact mode (ui.compact): the box is a bar in a transparent window that main sizes for the mode.
// The window lets clicks through, except while the mouse is over the drawn part.
type Mode = 'collapsed' | 'compose' | 'chat';
let compact = false;
let mode: Mode = 'collapsed';
const PLACEHOLDER: Record<Mode, string> = { collapsed: '', compose: 'Start new chat', chat: 'Reply…' };
const MAX_BOX = 480; // main caps the box at the full box's height
function setMode(m: Mode): void {
  mode = m;
  document.body.dataset.mode = m;
  input.placeholder = PLACEHOLDER[m];
  if (m === 'collapsed') input.blur(); // keys must not type into the hidden input
  pet.fitBox(m, m === 'chat' && !chatsPanel.hidden ? MAX_BOX : 0);
  checkInside();
}
function collapse(): void {
  if (!chatsPanel.hidden) void showList(false);
  setMode('collapsed');
}
// The pill stretches into the input bar; focus moves in once it has (at once if it already has, or with reduced motion).
function compose(): void {
  setMode('compose');
  if (bar.offsetWidth === form.offsetWidth || matchMedia('(prefers-reduced-motion: reduce)').matches) return input.focus();
  bar.addEventListener('transitionend', function done(e) {
    if (e.propertyName !== 'width') return;
    bar.removeEventListener('transitionend', done);
    if (mode !== 'collapsed') input.focus();
  });
}
document.getElementById('new-chat')!.addEventListener('click', compose);
pet.onCompose(compose); // the hotkey, pressed again on the collapsed bar
// + opens the chat list (attachments come in v0.2); the box grows to full height to hold it.
let listFrom: Mode = 'compose'; // where Esc in the list goes back to
document.getElementById('plus')!.addEventListener('click', () => {
  listFrom = mode;
  void showList(true);
  setMode('chat'); // after the list is unhidden, so the box grows to hold it
  search.focus(); // again: the list was not displayed yet when showList focused it
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && compact && mode !== 'collapsed') collapse();
});
let inside = false;
let dragging = false;
let mouse = { x: -1, y: -1 }; // the last (forwarded) mouse position; off the page once it left the window
// Re-checked on every move and mode change, so the click-through state can't go stale.
function checkInside(): void {
  if (!compact) return;
  const now = dragging || !!document.elementFromPoint(mouse.x, mouse.y)?.closest(mode === 'chat' ? '#box' : '#bar');
  if (now !== inside) pet.setMouseInside((inside = now));
}
document.addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  checkInside();
});
document.documentElement.addEventListener('mouseleave', () => {
  mouse = { x: -1, y: -1 };
  checkInside();
});
// The bar drags the box from anywhere but its buttons and input; main moves the window to follow the cursor.
bar.addEventListener('pointerdown', (e) => {
  if (!compact || e.button !== 0 || (e.target as Element).closest('button, textarea')) return;
  bar.setPointerCapture(e.pointerId);
  dragging = true;
  pet.dragBox('start');
});
bar.addEventListener('pointermove', () => {
  if (dragging) pet.dragBox('move');
});
function endDrag(): void {
  if (!dragging) return;
  dragging = false;
  pet.dragBox('end');
  checkInside();
}
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('lostpointercapture', endDrag);

compact = await pet.isCompact();
if (compact) setMode('collapsed');
resetChat(chatId);
