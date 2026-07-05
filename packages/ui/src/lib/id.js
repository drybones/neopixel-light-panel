// 8-char hex ids, matching the server's convention. crypto.randomUUID is
// only available in secure contexts (https / localhost) — the panel is
// normally browsed over plain http on the LAN, so fall back to
// getRandomValues, which has no such restriction.
export function newId() {
  if (window.crypto && window.crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
