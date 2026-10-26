import type { CanvasDoc } from "../../state/types";

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
