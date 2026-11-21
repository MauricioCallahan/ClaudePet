import { cellPosition, nextFrame, sheetSize } from './sprite.js';

declare const petWindow: {
  drag(phase: 'start' | 'move' | 'end'): void;
  onSheet(cb: (s: { url: string; columns: number; rows: number }) => void): void;
  onPlay(cb: (p: { row: number; durations: number[]; loop: boolean }) => void): void;
};

const el = document.getElementById('pet')!;
// With reduced motion the pet shows each row's first frame and stays still.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let timer: ReturnType<typeof setTimeout> | undefined;

// A press that moves a few pixels drags the box (main moves the pet with it); a plain click does nothing.
const body = document.body;
let down: { x: number; y: number } | null = null;
let moved = false;
body.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  body.setPointerCapture(e.pointerId); // the window moves under the cursor; keep its events
  down = { x: e.screenX, y: e.screenY };
  moved = false;
  petWindow.drag('start'); // main records the grab point now, so the box doesn't jump by the threshold
});
body.addEventListener('pointermove', (e) => {
  if (!down || (!moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) < 4)) return;
  moved = true;
  petWindow.drag('move');
});
body.addEventListener('lostpointercapture', () => {
  if (down && moved) petWindow.drag('end');
  down = null;
});

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
