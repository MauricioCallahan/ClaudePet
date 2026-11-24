// What the pet shows about Claude. Electron-free, so node --test can load it.

export type PetState = 'idle' | 'thinking' | 'working' | 'waiting' | 'replied' | 'error';
// stop covers Stop, New chat and reopening a chat: all go straight back to idle.
// tool: a tool started; text: reply text streams again, or the last running tool finished.
// ask: an approval card opened; answer: the last card was answered, so the tool runs (or Claude hears the deny).
export type PetEvent = 'send' | 'tool' | 'text' | 'ask' | 'answer' | 'end' | 'error' | 'stop' | 'settle';

// The same rows for every pet, since the Codex format fixes the row order (see ROWS in petFormat.ts).
// A sheet has its rows from the top, so one without row 1 (working) has only idle, which playableRow falls back to.
export const STATE_ROW: Record<PetState, number> = { idle: 0, thinking: 7, working: 1, waiting: 6, replied: 3, error: 5 };

export function nextState(s: PetState, e: PetEvent): PetState {
  switch (e) {
    case 'send':
      return 'thinking';
    case 'tool':
      return s === 'thinking' || s === 'working' ? 'working' : s;
    case 'text':
      return s === 'working' ? 'thinking' : s; // not from waiting: text can't stream while Claude waits on a card
    case 'ask':
      return s === 'thinking' || s === 'working' ? 'waiting' : s;
    case 'answer':
      return s === 'waiting' ? 'working' : s;
    case 'end':
      return s === 'thinking' || s === 'working' || s === 'waiting' ? 'replied' : s;
    case 'error':
      return 'error'; // also from idle: a message rejected before it was sent
    case 'stop':
      return 'idle';
    case 'settle':
      return s === 'replied' || s === 'error' ? 'idle' : s;
  }
}

export const SETTLE_MS = 3000; // how long replied and error show before the pet goes back to idle

// Holds the current state, plays it only when it changes, and settles replied and error back to idle.
// While the box is hidden they don't settle, so the pet still greets you with them when it is shown.
export function createMood(o: { play: (s: PetState) => void; visible: () => boolean; settleMs?: number }) {
  let state: PetState = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settleLater = () => {
    clearTimeout(timer);
    if ((state === 'replied' || state === 'error') && o.visible()) timer = setTimeout(() => event('settle'), o.settleMs ?? SETTLE_MS);
  };
  const event = (e: PetEvent): void => {
    const s = nextState(state, e);
    if (s === state) return; // a repeated error keeps its running timer, so it still settles
    state = s;
    o.play(s);
    settleLater();
  };
  return {
    event,
    // The box was shown: replay the state (a play-once row has finished while hidden) and settle from now.
    shown(): void {
      o.play(state);
      settleLater();
    },
  };
}
