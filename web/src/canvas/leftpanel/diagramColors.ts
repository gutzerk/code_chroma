const PALETTE = ["#6ea8ff", "#b794ff", "#5fd4a0", "#ffb86b", "#ff7a90", "#5fd0e0", "#e6d36a", "#c58bff"];

/** Deterministic swatch colour for a diagram layer, stable across sessions and components. */
export function colorForLayer(layer: string): string {
  let hash = 0;
  for (let i = 0; i < layer.length; i++) hash = (hash * 31 + layer.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
