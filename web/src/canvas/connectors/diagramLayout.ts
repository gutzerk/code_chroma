import { computeLayeredLayout, type LayoutEdge } from "./layeredLayout";
import { pairKeyOf, type Rect } from "./orthogonalRoute";
import { routeEdges } from "./routeEdges";

export interface LayoutBoxSpec {
  id: string;
  width: number;
  height: number;
  /** Authored step number (CONTEXT.md's "Order"), e.g. "1"/"2a" -- optional, decides this box's
   * layout rank directly when present (054-diagram-flow-order, ADR 0002). */
  order?: string;
  /** Authored performer name (CONTEXT.md's "Lane") -- optional, clusters same-value boxes adjacent
   * within a rank (054-diagram-flow-order). */
  lane?: string;
}

export interface PositionedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The stable adapter surface every diagram view reaches through `autoLayout.ts`'s
 * `layoutNewElements()`. The body delegates to `layeredLayout.ts`'s direction-aware layered
 * algorithm — an edge whose endpoint isn't a node is skipped, same as before the body swap. */
export function layoutBoxes(
  nodes: readonly LayoutBoxSpec[],
  edges: readonly LayoutEdge[],
): { boxes: PositionedBox[]; width: number; height: number } {
  return computeLayeredLayout(nodes, edges);
}

/** Every box is an obstacle for every arrow it isn't attached to, so a relationship line never
 * disappears under an unrelated box — the routing + edge-shape pass patternsGraphLayout and
 * customGraphLayout both ran verbatim before this was pulled out. The return type preserves each
 * relation's own `kind`/`label` types (via `Pick<T, ...>`) rather than widening to `string`, so a
 * caller with a narrow `kind` union (patterns' `PatternRelationKind`) doesn't need to re-cast. */
export function layoutDiagramEdges<
  T extends {
    from: string;
    to: string;
    kind?: string;
    label?: string;
    hero?: boolean;
    style?: Record<string, string> | null;
  },
>(
  relations: readonly T[],
  rectByKey: ReadonlyMap<string, Rect>,
  // Optional: a caller with authored edge keys (epics) keeps them instead of the computed default.
  keyOf?: (relation: T, index: number) => string,
): Array<
  Pick<T, "from" | "to" | "kind" | "label" | "hero" | "style"> & {
    key: string;
    d: string;
    labelX: number;
    labelY: number;
  }
> {
  return routeEdges(
    relations.map((relation, index) => ({ ...relation, index })),
    (relation) => pairKeyOf(relation.from, relation.to),
    (relation) => {
      const from = rectByKey.get(relation.from);
      const to = rectByKey.get(relation.to);
      return from && to ? { from, to } : null;
    },
    [...rectByKey.values()],
  ).map(({ item, route }) => ({
    key: keyOf ? keyOf(item, item.index) : `${item.from}->${item.to}-${item.kind}-${item.index}`,
    from: item.from,
    to: item.to,
    kind: item.kind,
    label: item.label,
    hero: item.hero,
    style: item.style,
    d: route.d,
    labelX: route.label.x,
    labelY: route.label.y,
  }));
}
