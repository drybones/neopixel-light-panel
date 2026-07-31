// Small colour helpers for scene swatches and hex entry.

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

export function hsvToHex(h, s, v) {
  h = ((h % 1) + 1) % 1 * 6;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const r = [v, q, p, p, t, v][i];
  const g = [t, v, v, q, p, p][i];
  const b = [p, p, t, v, v, q][i];
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Representative swatch colours for a layer, used on scene cards.
export function layerSwatches(layer) {
  const p = layer.params || {};
  switch (layer.effectType) {
    case 'wavelet':
    case 'planewave':
    case 'solid':
      return p.color ? [p.color] : [];
    case 'gradient':
      return (p.stops || []).map((s) => s.color);
    case 'noise':
      return [p.c1, p.c2].filter(Boolean);
    case 'twinkle':
      return p.color ? [p.color] : [];
    case 'embers':
      return [hsvToHex(p.hue ?? 0.035, 1, 1)];
    case 'candy_sparkler':
      return ['#e24b4a', '#efc44f', '#4fa5ef'];
    case 'particle_trail':
      return ['#4fefb8', '#4fa5ef'];
    default:
      // Unlike ParamPanel this cannot be driven off the schema, since a
      // representative colour is a judgement per effect. Falling back to a
      // plain `color` param at least stops a new effect leaving scene cards
      // blank until they are opened, which is how planewave first showed up.
      return p.color ? [p.color] : [];
  }
}

export function sceneSwatches(scene, max = 6) {
  if (!scene) return [];
  const colors = [];
  for (const layer of scene.layers) {
    for (const c of layerSwatches(layer)) {
      if (colors.length < max) colors.push(c);
    }
  }
  return colors;
}
