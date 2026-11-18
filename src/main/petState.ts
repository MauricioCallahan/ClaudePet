// What the pet shows about Claude. Electron-free, so node --test can load it.

export type PetState = 'idle' | 'thinking' | 'replied' | 'error';
// stop covers Stop, New chat and reopening a chat: all go straight back to idle.
export type PetEvent = 'send' | 'end' | 'error' | 'stop' | 'settle';

// The same rows for every pet, since the Codex format fixes the row order (see ROWS in petFormat.ts).
export const STATE_ROW: Record<PetState, number> = { idle: 0, thinking: 7, replied: 3, error: 5 };

export function nextState(s: PetState, e: PetEvent): PetState {
  switch (e) {
    case 'send':
      return 'thinking';
    case 'end':
      return s === 'thinking' ? 'replied' : s;
    case 'error':
      return 'error'; // also from idle: a message rejected before it was sent
    case 'stop':
      return 'idle';
    case 'settle':
      return s === 'replied' || s === 'error' ? 'idle' : s;
  }
}
