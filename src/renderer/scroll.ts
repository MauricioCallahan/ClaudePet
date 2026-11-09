// Keep following a growing reply only while the reader is at (or within `slack` px of) the bottom.
export function shouldStick(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 24): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
