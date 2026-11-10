// The pet element fills the window, so one sprite cell is drawn at 100vw x 100vh, whatever the pet's size.

// The frame after i, or null when a play-once row has shown its last frame.
export const nextFrame = (i: number, frames: number, loop: boolean): number | null => (i + 1 < frames ? i + 1 : loop ? 0 : null);

export const cellPosition = (row: number, frame: number): string => `${-frame * 100}vw ${-row * 100}vh`;

export const sheetSize = (columns: number, rows: number): string => `${columns * 100}vw ${rows * 100}vh`;
