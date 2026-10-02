/** The shared hash-a-string-into-a-palette-index loop behind every per-box color palette (real
 * structural group, Lane, Concurrency island -- 054-diagram-flow-order): each palette picks its own
 * `multiplier`/`charMultiplier`/`addend` so its index *sequence* differs from the others, but that is
 * not what keeps the three groupings visually distinct -- a numeric index collision between two
 * palettes is harmless. What actually guarantees no visual collision is that each palette renders
 * through its own CSS class (`canvas-group-frame-color-<n>` / `canvas-lane-area-color-<n>` /
 * `canvas-concurrency-island-color-<n>`), each with its own custom property and hex values, so the
 * same index in two different palettes still paints two different colors. */
export function hashStringToIndex(
  input: string,
  count: number,
  multiplier: number,
  charMultiplier = 1,
  addend = 0,
): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * multiplier + input.charCodeAt(index) * charMultiplier + addend) >>> 0;
  }
  return hash % count;
}
