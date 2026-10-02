import { hashStringToIndex } from "./paletteHash";

/** Small fixed palette a group name hashes into -- shared by nodeAccent.tsx's `meta.group` accent
 * (a per-box left border) and GroupFrame's own border/tint, so the same group name always reads as
 * the same color everywhere it shows up on the canvas. See styles.css's `custom-node-group-<n>` /
 * `canvas-group-frame-color-<n>` for the actual hex values, kept in sync by index. */
export const GROUP_COLOR_COUNT = 6;

export function groupColorIndex(name: string): number {
  return hashStringToIndex(name, GROUP_COLOR_COUNT, 31);
}
