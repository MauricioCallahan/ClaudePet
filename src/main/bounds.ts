export interface Rect { x: number; y: number; width: number; height: number }

const HEADER_MID = 20; // grab point: middle of the 40px-ish header strip
const MARGIN = 16;

// Keep the saved spot only if the header's centre is on some screen,
// otherwise the window could open unreachable (no taskbar button, no tray yet).
export function fitPosition(
  saved: { x: number; y: number },
  size: { width: number; height: number },
  workAreas: Rect[],
  primary: Rect,
): { x: number; y: number } {
  const px = saved.x + size.width / 2;
  const py = saved.y + HEADER_MID;
  const visible = workAreas.some(
    (a) => px >= a.x && px < a.x + a.width && py >= a.y && py < a.y + a.height,
  );
  if (visible) return saved;
  return {
    x: primary.x + primary.width - size.width - MARGIN,
    y: primary.y + primary.height - size.height - MARGIN,
  };
}

// The pet stands centered on the box's top edge; clamped so a box dragged past an edge never hides it.
export function petPosition(box: Rect, pet: { width: number; height: number }, area: Rect): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return {
    x: clamp(Math.round(box.x + (box.width - pet.width) / 2), area.x, area.x + area.width - pet.width),
    y: clamp(box.y - pet.height, area.y, area.y + area.height - pet.height),
  };
}

// Where the box must go so the pet standing on it fits below the top of the screen.
// A box too tall for what is left shrinks, so its input never ends up below the screen.
export function roomForPet(box: Rect, petHeight: number, area: Rect): Rect {
  const y = Math.max(box.y, area.y + petHeight);
  return { x: box.x, y, width: box.width, height: y === box.y ? box.height : Math.min(box.height, area.y + area.height - y) };
}
