// Small colour helpers for scene swatches.

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
    case 'solid':
      return p.color ? [p.color] : [];
    case 'gradient':
      return (p.stops || []).map((s) => s.color);
    case 'embers':
      return [hsvToHex(p.hue ?? 0.035, 1, 1)];
    case 'candy_sparkler':
      return ['#e24b4a', '#efc44f', '#4fa5ef'];
    case 'particle_trail':
      return ['#4fefb8', '#4fa5ef'];
    default:
      return [];
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
