/** Confines `value` to [min, max]. `max` is floored at `min` so inverted bounds (a viewport smaller
 * than a panel's own minimum, say) collapse to `min` rather than returning something below it. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}
