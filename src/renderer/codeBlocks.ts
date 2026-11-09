// Adds a Copy button to every code block in `root` (idempotent). Built in the DOM so Markdown cannot forge one.
export function addCopyButtons(root: ParentNode): void {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector(':scope > button.copy')) continue;
    const button = pre.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    pre.appendChild(button);
  }
}

// For a click target: the exact code of the block whose Copy button was clicked, else null.
export function codeToCopy(target: EventTarget | null): string | null {
  const el = target as Element | null;
  const pre = el?.closest?.('button.copy')?.closest('pre');
  return pre ? (pre.querySelector('code')?.textContent ?? '') : null;
}
