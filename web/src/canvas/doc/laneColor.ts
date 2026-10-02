import { hashStringToIndex } from "./paletteHash";

/** Small fixed palette a Lane name hashes into -- its own multiplier constants, distinct from
 * `groupColor.ts`'s (054-diagram-flow-order). Visual non-collision with the group/Concurrency-island
 * palettes comes from each rendering through its own CSS class, not from these constants -- see
 * `paletteHash.ts`. See styles.css's `canvas-lane-area-color-<n>` for the actual hex values, kept in
 * sync by index. */
export const LANE_COLOR_COUNT = 6;

export function laneColorIndex(name: string): number {
  return hashStringToIndex(name, LANE_COLOR_COUNT, 17, 7);
}
