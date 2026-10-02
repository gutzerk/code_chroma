import { useEffect, useRef, type DependencyList } from "react";
import { clamp } from "../util/clamp";
import { expansionStore } from "../state/expansionState";
import { pairKeyOf, type Rect } from "./connectors/orthogonalRoute";
import { routeEdges } from "./connectors/routeEdges";

/** The two strategy-specific class pairs a block renders with (boxes vs tree). Overlays that walk
 * the DOM must use these rather than restating the strings — a third render strategy extends this
 * one place instead of three overlays. */
export const BLOCK_ROW_SELECTOR = ".block-row, .tree-node-main-row";
export const BLOCK_HEADER_SELECTOR = ".block-header, .tree-node-row";

/** Screen-to-local coordinate converter for one recompute pass, or null if `svg` isn't mounted/
 * measurable yet. Every canvas SVG overlay (ConnectionsOverlay, ChangeConnectionsOverlay,
 * TraceFlowOverlay) lives inside `.canvas-content`, so `svg.getScreenCTM()` already bakes in the
 * ambient pan/zoom transform — inverting it once per recompute (not per point) lets callers convert
 * as many `getBoundingClientRect()`-derived screen points as they need via the returned function. */
export function getToLocal(
  svg: SVGSVGElement | null,
): ((x: number, y: number) => DOMPoint) | null {
  // jsdom implements neither getScreenCTM nor a matrix-aware DOMPoint, so an overlay mounted in a
  // unit test that doesn't stub them reports "not measurable yet" rather than throwing.
  if (!svg || typeof svg.getScreenCTM !== "function") return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inverse = ctm.inverse();
  return (x: number, y: number) => new DOMPoint(x, y).matrixTransform(inverse);
}

/** The element whose box marks a block's own footprint, excluding its expanded children — an arrow
 * must attach to the block itself, not to the whole subtree it happens to be showing. */
function footprintOf(element: HTMLElement): HTMLElement {
  const row = element.closest(BLOCK_ROW_SELECTOR);
  return row?.querySelector<HTMLElement>(BLOCK_HEADER_SELECTOR) ?? element;
}

/** A screen-space box in getBoundingClientRect terms (left/top/right/bottom). */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One raw id pair resolved to its endpoints' nearest visible ancestors, deduped by direction —
 * a collapsed hop still draws a visible line, and A->A after collapsing draws nothing.
 * ConnectionsOverlay and RouteProbeOverlay both need this before measuring boxes. */
export interface ResolvedEdge<T> {
  key: string;
  fromId: string;
  toId: string;
  item: T;
}

export function resolveVisibleEdges<T>(
  items: T[],
  idsOf: (item: T) => readonly [string, string],
): ResolvedEdge<T>[] {
  const seen = new Set<string>();
  const resolved: ResolvedEdge<T>[] = [];
  for (const item of items) {
    const [rawFrom, rawTo] = idsOf(item);
    const fromId = expansionStore.getNearestVisibleAncestor(rawFrom);
    const toId = expansionStore.getNearestVisibleAncestor(rawTo);
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}->${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ key, fromId, toId, item });
  }
  return resolved;
}

/** The shared "N noun(s)" aria-label idiom every overlay's empty/non-empty state uses. */
export function countLabel(
  count: number,
  noun: string,
  opts?: { emptyText?: string; prefix?: string; suffix?: string },
): string {
  if (count === 0) return opts?.emptyText ?? `No ${noun}s`;
  const plural = `${noun}${count === 1 ? "" : "s"}`;
  const prefix = opts?.prefix ? `${opts.prefix} ` : "";
  const suffix = opts?.suffix ? ` ${opts.suffix}` : "";
  return `${prefix}${count} ${plural}${suffix}`;
}

/** The border-to-border segment between two boxes: on each box, the point nearest the other's
 * center — so a connector meets each edge from whatever direction the boxes sit in. Plan and trace
 * overlays used to each hand-roll this clamp pair. */
export function borderSegment(
  a: ScreenBox,
  b: ScreenBox,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const aCenter = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
  const bCenter = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  return {
    from: { x: clamp(bCenter.x, a.left, a.right), y: clamp(bCenter.y, a.top, a.bottom) },
    to: { x: clamp(aCenter.x, b.left, b.right), y: clamp(aCenter.y, b.top, b.bottom) },
  };
}

/** A block's footprint as a rect in `.canvas-content` coordinates. The canvas transform is only ever
 * a scale plus a translate, so converting the two opposite corners is enough. */
export function localRectOf(
  element: HTMLElement,
  toLocal: (x: number, y: number) => DOMPoint,
): Rect {
  const box = footprintOf(element).getBoundingClientRect();
  const topLeft = toLocal(box.left, box.top);
  const bottomRight = toLocal(box.right, box.bottom);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/** Measures each item's endpoints as live on-screen boxes and routes edges around obstacles --
 * the pipeline ConnectionsOverlay and RouteProbeOverlay both run inside `useOverlaySvgRef`. An item
 * whose endpoint node isn't currently in the DOM is dropped, same as a hand-rolled flatMap would. */
export function measureAndRouteEdges<T extends { fromId: string; toId: string }>(
  svg: SVGSVGElement | null,
  items: readonly T[],
): { item: T; d: string }[] {
  const toLocal = getToLocal(svg);
  if (!toLocal) return [];
  const localRect = (nodeId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
    return el ? localRectOf(el, toLocal) : null;
  };
  const measured = items.flatMap((item) => {
    const from = localRect(item.fromId);
    const to = localRect(item.toId);
    return from && to ? [{ item, from, to }] : [];
  });
  // A→B and B→A survive dedupe as two connections, so they get two lanes rather than one stroke.
  // Obstacles are the same measured footprints the arrows attach to -- see obstacleRouter's nesting
  // skip rule (nested DOM means a parent's rect contains its children's anchors) before changing this.
  return routeEdges(
    measured,
    (m) => pairKeyOf(m.item.fromId, m.item.toId),
    (m) => ({ from: m.from, to: m.to }),
    measured.flatMap((m) => [m.from, m.to]),
  ).map(({ item, route }) => ({ item: item.item, d: route.d }));
}

/** How many extra frames after the triggering commit each overlay re-measures on. One frame was not
 * enough: an expand trigger fires synchronously at click time, and rAF callbacks run *before*
 * ResizeObserver delivery, so a single retry could still measure pre-relayout geometry. Same
 * bounded "retry while layout settles" idiom as C1View's FIT_MAX_FRAMES, at a fraction of the count
 * because a pass is only a handful of getBoundingClientRect calls. Async growth arriving later than
 * this (a child fetch resolving) is covered by canvasLayoutStore instead. */
export const OVERLAY_SETTLE_FRAMES = 4;

/** Shared lifecycle every canvas SVG overlay needs: run `recompute` now, again on each of the next
 * few frames while layout settles (overlay targets often mount asynchronously — lazily-fetched
 * children, a just-revealed panel — and `getToLocal` reports "not measurable yet" until the SVG
 * itself is mounted), and again on window resize. Each overlay still owns its own `recompute`
 * closure/dependency list; this only shares the raf-plus-resize-listener plumbing that was
 * previously hand-copied into three separate overlays. */
export function useOverlaySvgRef(recompute: () => void, deps: DependencyList) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    recompute();
    let raf = 0;
    let remaining = OVERLAY_SETTLE_FRAMES;
    const settle = () => {
      recompute();
      remaining -= 1;
      if (remaining > 0) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return svgRef;
}
