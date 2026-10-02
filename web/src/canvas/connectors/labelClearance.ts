import type { ScreenBox } from "../canvasOverlay";

/** True iff two axis-aligned screen boxes share any area — touching edges (a.right === b.left) don't count. */
function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Every pair of rects (by id) whose boxes overlap, checked once per unordered pair — O(n²) is fine at diagram scale. */
export function findOverlaps(rects: { id: string; box: ScreenBox }[]): [string, string][] {
  const clashes: [string, string][] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (boxesOverlap(rects[i].box, rects[j].box)) clashes.push([rects[i].id, rects[j].id]);
    }
  }
  return clashes;
}
