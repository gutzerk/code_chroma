import { hashStringToIndex } from "./paletteHash";

/** Small fixed palette a group name hashes into -- shared by nodeAccent.tsx's `meta.group` accent
 * (a per-box left border) and GroupFrame's own border/tint, so the same group name always reads as
 * the same color everywhere it shows up on the canvas. See styles.css's `custom-node-group-<n>` /
 * `canvas-group-frame-color-<n>` for the actual hex values, kept in sync by index. */
export const GROUP_COLOR_COUNT = 6;

export function groupColorIndex(name: string): number {
  return hashStringToIndex(name, GROUP_COLOR_COUNT, 31);
}

/** Board role tint by group name (web cyan, bridge/core green, skills violet); undefined falls back to the hash. */
export function groupRoleIndex(name: string): number | undefined {
  const label = name.toLowerCase();
  if (/skill/.test(label)) return 4;
  if (/(^|[^a-z])web([^a-z]|$)|frontend|canvas|ui/.test(label)) return 5;
  if (/bridge|core|engine|dotnet|backend/.test(label)) return 1;
  return undefined;
}
