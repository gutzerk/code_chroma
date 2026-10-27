import type { ReactNode } from "react";
import type { CanvasDoc, ImpactChanges } from "../state/types";
import { useCanvasDoc } from "./doc/canvasDocStore";
import { elementRect } from "./doc/elementRect";
import { PADDING } from "./doc/DiagramFrame";
import { aliasesOf } from "./doc/impactEdgeStatus";
import { mergedPillRect, useMergedPills } from "./doc/impactBoxState";

export interface BoardBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const BOARD_GAP = 24;
export const CARD_WIDTH = 448;
const MIN_BAR_WIDTH = 480;

const boundsCache = new WeakMap<CanvasDoc["elements"], BoardBounds | null>();

/** The union rect of the Impact layer's elements in canvas coordinates, or null when it has none. */
export function impactBoundsOf(doc: CanvasDoc): BoardBounds | null {
  if (boundsCache.has(doc.elements)) return boundsCache.get(doc.elements) ?? null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of Object.values(doc.elements)) {
    if (element.layer !== "impact") continue;
    const rect = elementRect(element);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  if (left === Infinity) {
    boundsCache.set(doc.elements, null);
    return null;
  }
  // The union of the members grown by the diagram frame's own padding, so the bars clear its border and title.
  const width = Math.max(right - left + 2 * PADDING.side, MIN_BAR_WIDTH);
  const bounds = { left: left - PADDING.side, top: top - PADDING.top, width, height: bottom - top + PADDING.top + PADDING.bottom };
  boundsCache.set(doc.elements, bounds);
  return bounds;
}

export function useImpactBounds(): BoardBounds | null {
  return impactBoundsOf(useCanvasDoc());
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
  const rectOf = (element: CanvasDoc["elements"][string]) => {
    const group = merged.get(element.id);
    const leader = group ? doc.elements[group.leader] : undefined;
    return leader ? mergedPillRect(leader) : elementRect(element);
  };
  const lines: { key: string; seg: Segment; label: string }[] = [];
  const findElement = (nodeId: string | null | undefined, name: string) => {
    const wanted = [nodeId, name].filter(Boolean);
    return Object.values(doc.elements).find(
      (element) => element.layer === "impact" && aliasesOf(doc, element.id).some((id) => wanted.includes(id)),
    );
  };
  for (const rel of changes.relationships) {
    if (rel.status !== "removed") continue;
    const from = findElement(rel.from_node_id, rel.from);
    const to = findElement(rel.to_node_id, rel.to);
    if (!from || !to || from.id === to.id) continue;
    if (Object.values(doc.edges).some((edge) => edge.from === from.id && edge.to === to.id)) continue;
    lines.push({ key: `${from.id}>${to.id}`, seg: trimmedSegment(rectOf(from), rectOf(to)), label: rel.label });
  }
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

/** The board's chrome around the diagram: a wide header bar above it, the outside strip below, the legend beside. */
export function ImpactBoard({
  changes,
  header,
  outside,
  legend,
}: {
  changes: ImpactChanges;
  header: ReactNode;
  outside: ReactNode;
  legend: ReactNode;
}) {
  const doc = useCanvasDoc();
  const bounds = impactBoundsOf(doc);
  if (!bounds) {
    return (
      <div className="impact-board impact-board--flow" data-testid="impact-board">
        {header}
        {outside}
        {legend}
      </div>
    );
  }
  return (
    <>
      <div
        className="impact-board-anchor impact-board-anchor--top"
        data-testid="impact-board"
        style={{ left: bounds.left, top: bounds.top, width: bounds.width }}
      >
        {header}
      </div>
      <div
        className="impact-board-anchor impact-board-anchor--bottom"
        style={{ left: bounds.left, top: bounds.top + bounds.height, width: bounds.width }}
      >
        {outside}
      </div>
      <div
        className="impact-board-anchor impact-board-anchor--side"
        style={{ left: bounds.left + bounds.width + BOARD_GAP, top: bounds.top }}
      >
        {legend}
      </div>
      <RemovedLinks changes={changes} doc={doc} />
    </>
  );
}
