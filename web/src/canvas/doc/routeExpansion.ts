import type { CanvasElement } from "../../state/types";
import { routeStepOf } from "./routeStep";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";

/** Height one expanded child row adds, and the fixed padding around the list. */
export const ROUTE_CHILD_ROW_HEIGHT = 24;
export const ROUTE_CHILD_LIST_PAD = 14;

/** Extra height an expanded step needs for `count` (> 0) children. */
const expandedExtraHeight = (count: number): number => count * ROUTE_CHILD_ROW_HEIGHT + ROUTE_CHILD_LIST_PAD;

const sizeOf = (element: CanvasElement) => ({
  w: element.size?.w ?? DEFAULT_ELEMENT_SIZE.w,
  h: element.size?.h ?? DEFAULT_ELEMENT_SIZE.h,
});

/**
 * The elements as laid out with the expanded route steps grown: each grows downward by its children
 * list and pushes every same-layer box below it (horizontally overlapping) down by the same amount.
 * Display only -- derived per render, never written back to the document.
 */
export function expandRouteElements(
  elements: Record<string, CanvasElement>,
  expanded: ReadonlySet<string>,
): Record<string, CanvasElement> {
  if (expanded.size === 0) return elements;
  const next = { ...elements };
  const targets: { id: string; count: number; y: number }[] = [];
  for (const id of expanded) {
    const count = next[id] ? (routeStepOf(next[id])?.children.length ?? 0) : 0;
    if (count > 0) targets.push({ id, count, y: next[id].position.y });
  }
  targets.sort((a, b) => a.y - b.y);
  for (const target of targets) {
    const current = next[target.id];
    const extra = expandedExtraHeight(target.count);
    const { w, h } = sizeOf(current);
    const bottom = current.position.y + h / 2;
    const left = current.position.x - w / 2;
    const right = current.position.x + w / 2;
    next[target.id] = { ...current, position: { ...current.position, y: current.position.y + extra / 2 }, size: { w, h: h + extra } };
    for (const other of Object.values(next)) {
      if (other.id === target.id || other.layer !== current.layer) continue;
      const o = sizeOf(other);
      const overlapsX = other.position.x - o.w / 2 < right && other.position.x + o.w / 2 > left;
      if (!overlapsX || other.position.y - o.h / 2 < bottom - 1) continue;
      next[other.id] = { ...other, position: { ...other.position, y: other.position.y + extra } };
    }
  }
  return next;
}
