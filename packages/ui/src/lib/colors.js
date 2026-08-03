// Colour parsing for the hex fields.

// Hex is what the params hold and what react-colorful speaks, so a typed colour
// only has to be read back into the same '#rrggbb' the server's prepare() parses
// and the swatch comparison expects. Typing tolerates a missing '#' and the
// 3-digit shorthand; anything else is not a colour, and returning null lets the
// field abandon the edit rather than commit junk.
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const formatHex = (value) => String(value).toLowerCase();

export function parseHex(text) {
  const match = HEX.exec(String(text).trim());
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`;
}
