// Only web pages may be handed to the OS; file:, javascript: and custom schemes from a reply must never open.
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
