import { hashStringToIndex } from "./paletteHash";

/** Small fixed palette a Concurrency island's leading `order` digit hashes into -- its own multiplier
 * constants, distinct from `groupColor.ts`'s and `laneColor.ts`'s (054-diagram-flow-order). Visual
 * non-collision with the other two palettes comes from each rendering through its own CSS class, not
 * from these constants -- see `paletteHash.ts`. See styles.css's
 * `canvas-concurrency-island-color-<n>` for the actual hex values, kept in sync by index. */
export const CONCURRENCY_ISLAND_COLOR_COUNT = 6;

export function concurrencyIslandColorIndex(digits: string): number {
  return hashStringToIndex(digits, CONCURRENCY_ISLAND_COLOR_COUNT, 13, 5, 3);
}
