import { cellPosition, nextFrame, sheetSize } from './sprite.js';

declare const petWindow: {
  click(): void;
  onSheet(cb: (s: { url: string; columns: number; rows: number }) => void): void;
  onPlay(cb: (p: { row: number; durations: number[]; loop: boolean }) => void): void;
};

const el = document.getElementById('pet')!;
// With reduced motion the pet shows each row's first frame and stays still.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let timer: ReturnType<typeof setTimeout> | undefined;

document.body.addEventListener('click', () => petWindow.click());

// Until a sheet arrives the placeholder from pet.css stays.
petWindow.onSheet(({ url, columns, rows }) => {
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = sheetSize(columns, rows);
});

petWindow.onPlay(({ row, durations, loop }) => {
  clearTimeout(timer);
  const show = (i: number) => {
    el.style.backgroundPosition = cellPosition(row, i);
    el.dataset.row = String(row);
    el.dataset.frame = String(i);
    const next = nextFrame(i, durations.length, loop);
    if (next !== null && !still) timer = setTimeout(() => show(next), durations[i]);
  };
  show(0);
});
