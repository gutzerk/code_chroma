import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { CanvasDoc, ImpactChanges } from "../state/types";
import { useCanvasDoc } from "./doc/canvasDocStore";
import { dragOffsetStore, type LiveDragOffset } from "./doc/dragOffsetStore";
import { unionBoundsOf, type UnionBounds } from "./doc/boundingBox";
import { offsetDraggedElements } from "./doc/displayPipeline";
import { elementRect } from "./doc/elementRect";
import { PADDING } from "./doc/DiagramFrame";
import { aliasesOf } from "./doc/impactEdgeStatus";
import { mergedPillRect, useMergedPills } from "./doc/impactBoxState";
import { BOARD_BAR, IMPACT_LAYER, impactFrameBounds } from "./doc/impactBoardLayout";

export interface BoardBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const BOARD_GAP = 24;
export const CARD_WIDTH = 448;
/** The legend column's width beside the board (design: 348). */
export const SIDE_WIDTH = 348;

const boundsCache = new WeakMap<CanvasDoc["elements"], BoardBounds | null>();

const NO_SIZES = new Map();

function unionOf(elements: CanvasDoc["elements"]): BoardBounds | null {
  const union = unionBoundsOf(Object.values(elements).filter((element) => element.layer === IMPACT_LAYER), NO_SIZES);
  return union && { left: union.left, top: union.top, width: union.right - union.left, height: union.bottom - union.top };
}

/** The union rect of the Impact layer's elements in canvas coordinates, or null when it has none. */
export function impactBoundsOf(doc: CanvasDoc): BoardBounds | null {
  if (!boundsCache.has(doc.elements)) boundsCache.set(doc.elements, unionOf(doc.elements));
  return boundsCache.get(doc.elements) ?? null;
}

let lastLive: { doc: CanvasDoc; offsets: Record<string, LiveDragOffset>; bounds: BoardBounds | null } | null = null;

/** The bounds shifted by an in-flight drag, so the chrome follows the frame instead of jumping on drop; stable per input. */
export function liveImpactBounds(doc: CanvasDoc, offsets: Record<string, LiveDragOffset>): BoardBounds | null {
  const dragging = Object.keys(offsets).some((id) => doc.elements[id]?.layer === IMPACT_LAYER);
  if (!dragging) return impactBoundsOf(doc);
  if (lastLive?.doc !== doc || lastLive.offsets !== offsets) {
    lastLive = { doc, offsets, bounds: unionOf(offsetDraggedElements(doc.elements, { dragOffsets: offsets })) };
  }
  return lastLive.bounds;
}

export interface BoardGeometry {
  header: BoardBounds;
  outside: BoardBounds;
  side: { left: number; top: number };
}

/** Where the summary bar, outside strip and legend column sit around the folders, from IMPACT_PROFILE's own frame. */
export function impactBoardGeometry(union: BoardBounds): BoardGeometry {
  const base: UnionBounds = { left: union.left, top: union.top, right: union.left + union.width, bottom: union.top + union.height };
  const frame = impactFrameBounds(base);
  const width = frame.right - frame.left;
  return {
    header: { left: frame.left, top: frame.top, width, height: BOARD_BAR.height },
    outside: { left: frame.left, top: frame.bottom - BOARD_BAR.outside, width, height: BOARD_BAR.outside },
    side: { left: frame.right + PADDING.side + BOARD_GAP, top: frame.top },
  };
}

/** Re-renders only when the board's bounds change, not on every drag frame of an unrelated element. */
export function useImpactBounds(): BoardBounds | null {
  const doc = useCanvasDoc();
  return useSyncExternalStore(dragOffsetStore.subscribe, () => liveImpactBounds(doc, dragOffsetStore.getAll()));
}

type Segment = [number, number, number, number];

/** Centre-to-centre segment between two rects, trimmed to their borders. */
function trimmedSegment(a: BoardBounds, b: BoardBounds): Segment {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - ax;
  const dy = b.top + b.height / 2 - ay;
  const exit = (rect: BoardBounds) =>
    Math.min(dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx), dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy));
  const ta = exit(a);
  const tb = exit(b);
  return [ax + dx * ta, ay + dy * ta, ax + dx - dx * tb, ay + dy - dy * tb];
}

/** Links the change removed that the diagram draws no arrow for: a dashed rose line between the two boxes. */
function RemovedLinks({ changes, doc }: { changes: ImpactChanges; doc: CanvasDoc }) {
  const merged = useMergedPills(doc);
  const lines = useMemo(() => {
    const rectOf = (element: CanvasDoc["elements"][string]) => {
      const group = merged.get(element.id);
      const leader = group ? doc.elements[group.leader] : undefined;
      return leader ? mergedPillRect(leader) : elementRect(element);
    };
    const out: { key: string; seg: Segment; label: string }[] = [];
    const byAlias = new Map<string, CanvasDoc["elements"][string]>();
    for (const element of Object.values(doc.elements)) {
      if (element.layer !== IMPACT_LAYER) continue;
      for (const id of aliasesOf(doc, element.id)) if (!byAlias.has(id)) byAlias.set(id, element);
    }
    const drawn = new Set(Object.values(doc.edges).map((edge) => `${edge.from}>${edge.to}`));
    const findElement = (nodeId: string | null | undefined, name: string) =>
      (nodeId ? byAlias.get(nodeId) : undefined) ?? byAlias.get(name);
    for (const rel of changes.relationships) {
      if (rel.status !== "removed") continue;
      const from = findElement(rel.from_node_id, rel.from);
      const to = findElement(rel.to_node_id, rel.to);
      if (!from || !to || from.id === to.id || drawn.has(`${from.id}>${to.id}`)) continue;
      out.push({ key: `${from.id}>${to.id}`, seg: trimmedSegment(rectOf(from), rectOf(to)), label: rel.label });
    }
    return out;
  }, [changes.relationships, doc, merged]);
  if (lines.length === 0) return null;
  return (
    <svg className="impact-removed-links" width="1" height="1" aria-hidden="true" data-testid="impact-removed-links">
      {lines.map(({ key, seg, label }) => (
        <g key={key} data-testid="impact-removed-link">
          <line x1={seg[0]} y1={seg[1]} x2={seg[2]} y2={seg[3]} className="impact-removed-link-line" />
          <text x={(seg[0] + seg[2]) / 2} y={(seg[1] + seg[3]) / 2 - 6} className="impact-removed-link-label">
            {label || "removed"}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The board's chrome around the folders: the summary bar above, the outside strip below, legend and review beside. */
export function ImpactBoard({
  changes,
  header,
  outside,
  legend,
  review,
}: {
  changes: ImpactChanges;
  header: ReactNode;
  outside: ReactNode;
  legend: ReactNode;
  review?: ReactNode;
}) {
  const doc = useCanvasDoc();
  const bounds = useImpactBounds();
  if (!bounds) {
    return (
      <div className="impact-board impact-board--flow" data-testid="impact-board">
        {header}
        {outside}
        {legend}
        {review}
      </div>
    );
  }
  const geometry = impactBoardGeometry(bounds);
  return (
    <>
      <div
        className="impact-board-anchor"
        data-testid="impact-board"
        style={geometry.header}
      >
        {header}
      </div>
      {outside && (
        <div
          className="impact-board-anchor"
          style={{ left: geometry.outside.left, top: geometry.outside.top, width: geometry.outside.width }}
        >
          {outside}
        </div>
      )}
      <div
        className="impact-board-anchor"
        style={{ left: geometry.side.left, top: geometry.side.top, width: SIDE_WIDTH }}
      >
        {legend}
        {review}
      </div>
      <RemovedLinks changes={changes} doc={doc} />
    </>
  );
}
