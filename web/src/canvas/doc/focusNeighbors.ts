import type { CanvasDoc } from "../../state/types";
import { edgeVisual, type EdgeVisual } from "./edgeKinds";

export type FocusDirection = "both" | "upstream" | "downstream";

export interface FocusSets {
  /** Elements that call/point at the focused one. */
  calledBy: string[];
  /** Elements the focused one calls/points at. */
  uses: string[];
}

/** The direct neighbours of `id` over the doc's edges, split into callers and callees. */
export function neighboursOf(doc: CanvasDoc, id: string): FocusSets {
  const calledBy = new Set<string>();
  const uses = new Set<string>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.to === id && edge.from !== id) calledBy.add(edge.from);
    if (edge.from === id && edge.to !== id) uses.add(edge.to);
  }
  return { calledBy: [...calledBy], uses: [...uses] };
}

/** Ids that stay lit when `id` is focused in `direction`: itself plus the chosen neighbours. */
export function litIdsFor(doc: CanvasDoc, id: string, direction: FocusDirection): Set<string> {
  const { calledBy, uses } = neighboursOf(doc, id);
  const lit = new Set([id]);
  if (direction !== "downstream") calledBy.forEach((n) => lit.add(n));
  if (direction !== "upstream") uses.forEach((n) => lit.add(n));
  return lit;
}

export interface NeighbourLink {
  id: string;
  /** The edge's own label, or its non-generic kind; empty when neither says anything. */
  label: string;
  visual: EdgeVisual;
}

/** Like `neighboursOf` but keeps the first edge's label and visual family per neighbour. */
export function neighbourLinks(doc: CanvasDoc, id: string): { calledBy: NeighbourLink[]; uses: NeighbourLink[] } {
  const calledBy = new Map<string, NeighbourLink>();
  const uses = new Map<string, NeighbourLink>();
  for (const edge of Object.values(doc.edges)) {
    const kind = edge.kind && edge.kind !== "uses" ? edge.kind : "";
    const link = (other: string): NeighbourLink => ({
      id: other,
      label: edge.label || kind,
      visual: edgeVisual(edge.kind, edge.transport),
    });
    if (edge.to === id && edge.from !== id && !calledBy.has(edge.from)) calledBy.set(edge.from, link(edge.from));
    if (edge.from === id && edge.to !== id && !uses.has(edge.to)) uses.set(edge.to, link(edge.to));
  }
  return { calledBy: [...calledBy.values()], uses: [...uses.values()] };
}
