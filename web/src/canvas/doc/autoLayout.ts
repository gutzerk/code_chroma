import { layoutBoxes } from "../connectors/diagramLayout";
import type { CanvasDoc, CanvasPosition } from "../../state/types";
import { stringMeta } from "./elementMeta";

const DEFAULT_SIZE = { width: 220, height: 72 };
// Vertical gap below the document's existing content before a fresh batch's own layered block starts.
const NEW_ELEMENTS_MARGIN = 80;

/**
 * Positions brand-new elements (added by one recipe run or one chat-skill batch) with a single
 * direction-aware layered-layout pass over just that subgraph (`layeredLayout.ts`,
 * 051-directed-layered-diagram-layout), then shifts the whole result below whatever is already on
 * the document — so a fresh batch never lands on top of existing boxes. Every existing element's
 * position is left untouched: only `newIds` are ever repositioned (016-single-canvas-dashboard's
 * "only new_elements get auto-positioned" rule). Returns positions keyed by element id, for the
 * caller to fold into `update_element` ops — this module never writes to the document itself.
 *
 * Known gap (051): the edge filter below only keeps edges where *both* endpoints are in `newIds`, so
 * an edge from a new element to an already-placed one plays no part in this layout pass — a newly
 * added node is never ranked relative to existing boxes, only relative to other new ones. The
 * "source above target" guarantee therefore only holds within one `layoutBoxes()` call (typically a
 * first draw), not across incremental batches.
 */
export function layoutNewElements(
  doc: CanvasDoc,
  newIds: readonly string[],
): Record<string, CanvasPosition> {
  const newIdSet = new Set(newIds);
  const nodes = newIds
    .map((id) => doc.elements[id])
    .filter((element): element is NonNullable<typeof element> => Boolean(element))
    .map((element) => ({
      id: element.id,
      width: element.size?.w ?? DEFAULT_SIZE.width,
      height: element.size?.h ?? DEFAULT_SIZE.height,
      order: stringMeta(element, "order"),
      lane: stringMeta(element, "lane"),
    }));
  if (nodes.length === 0) return {};

  const edges = Object.values(doc.edges)
    .filter((edge) => newIdSet.has(edge.from) && newIdSet.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }));

  const { boxes } = layoutBoxes(nodes, edges);

  // `existingElements.length === 0` is the real "nothing there yet" signal -- clamping the computed
  // max to 0 used to double as that check too, but a populated diagram sitting entirely above y=0
  // (bottom edge still negative) also clamps to 0, silently dropping yOffset and landing the next
  // diagram right on top of it instead of below it.
  const existingElements = Object.values(doc.elements).filter(
    (element) => !newIdSet.has(element.id),
  );
  const yOffset =
    existingElements.length > 0
      ? Math.max(
          ...existingElements.map(
            (element) => element.position.y + (element.size?.h ?? DEFAULT_SIZE.height) / 2,
          ),
        ) + NEW_ELEMENTS_MARGIN
      : 0;

  const positions: Record<string, CanvasPosition> = {};
  for (const box of boxes) {
    positions[box.id] = { x: box.x, y: box.y + yOffset };
  }
  return positions;
}
