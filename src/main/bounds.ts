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
