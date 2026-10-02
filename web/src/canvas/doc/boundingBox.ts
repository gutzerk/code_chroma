import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { elementRect } from "./elementRect";

export interface UnionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The union rect enclosing every member's current on-screen bounds -- one shared calculation for
 * `GroupFrame` (a real, author-created structural group), `LaneArea`, and `ConcurrencyIslandArea`
 * (both derived purely from `meta.lane`/`meta.order`, 054-diagram-flow-order), so "bounding box of a
 * set of boxes" lives in exactly one place instead of three near-identical copies. Returns `null` for
 * an empty set so every caller can render nothing instead of a NaN-sized rect. */
export function unionBoundsOf(
  members: readonly CanvasElement[],
  sizes: ReadonlyMap<string, MeasuredBoxSize>,
): UnionBounds | null {
  if (members.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const member of members) {
    const rect = elementRect(member, sizes);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, right, bottom };
}
