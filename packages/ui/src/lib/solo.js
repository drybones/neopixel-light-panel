// While any layer is soloed, the server draws the bottommost soloed layer as
// Normal, whatever its stored blend mode: the composite starts black, and a
// Multiply or Darken layer over black is black (#132). The rule has to match
// engine/scene-store.js prepareScene, which picks the same layer as the first
// of `solo && enabled` in bottom-first order — a hidden soloed layer is not
// drawn, so it can't be the base.
//
// Returns that layer's id, or null when nothing is soloed.
export function soloBaseId(layers) {
  const base = (layers || []).find((l) => l.solo && l.enabled);
  return base ? base.id : null;
}

// True when the override changes what is drawn for this layer, i.e. the one
// case worth telling the user about.
export function isBlendOverridden(layers, layer) {
  return !!layer && layer.blendMode !== 'normal' && soloBaseId(layers) === layer.id;
}
