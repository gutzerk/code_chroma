import { layoutBoxes } from "../connectors/diagramLayout";
import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { orderMeta, stringMeta } from "./elementMeta";
import { isEpicsLayer, layoutEpics } from "./epicsLayout";
import { layoutBoxSize, measureBoxSize } from "./measureBoxSize";
import { placeIncrementally } from "./incrementalLayout";
import { layersWithProfile, profileForElement } from "./diagramProfiles";

const DEFAULT_SIZE = { width: 300, height: 72 };
// Vertical gap below the document's existing content before a fresh batch's own layered block starts.
const NEW_ELEMENTS_MARGIN = 80;

/**
 * Positions brand-new elements (added by one recipe run or one chat-skill batch) with a single
 * ELK layered-layout pass over just that subgraph (`elkLayout.ts`), then shifts the whole result
 * below whatever is already on the document — so a fresh batch never lands on top of existing boxes. Every existing element's
 * position is left untouched: only `newIds` are ever repositioned (016-single-canvas-dashboard's
 * "only new_elements get auto-positioned" rule). Returns positions keyed by element id, for the
 * caller to fold into `update_element` ops — this module never writes to the document itself.
 *
 * Two modes. A fresh draw (no other placed element in the new elements' layer) is laid out alone and
 * stacked below the existing canvas. An incremental update (the layer already has placed boxes) goes
 * through `incrementalLayout.ts`: every placed box keeps its position, and each new one lands next to
 * the boxes it connects to, offset by wherever the user moved them.
 */
export interface LayoutResult {
  positions: Record<string, CanvasPosition>;
  /** Sizes the layout derived for the boxes it positioned (e.g. a content-fit epics width) -- the
   * caller persists these alongside positions so the renderer honors what auto-layout decided. */
  sizes?: Record<string, CanvasSize>;
}

export async function layoutNewElements(
  doc: CanvasDoc,
  newIds: readonly string[],
  // Positions that override the doc's for kept elements (e.g. ones about to be restored from the cache).
  fixed: Readonly<Record<string, CanvasPosition>> = {},
): Promise<LayoutResult> {
  const newIdSet = new Set(newIds);
  // A profile with its own layout (a sequence board) places each layer's boxes deterministically; every other new box goes through ELK.
  const newElements = newIds.map((id) => doc.elements[id]).filter((element): element is CanvasElement => Boolean(element));
  const ownLayoutLayers = layersWithProfile(newElements, "layout");
  const ownLayoutIdSet = new Set([...ownLayoutLayers.values()].flatMap(({ ids }) => ids));
  const elkIds = newIds.filter((id) => !ownLayoutIdSet.has(id));
  const ownLayout: Required<LayoutResult> = { positions: {}, sizes: {} };
  for (const { profile, ids } of ownLayoutLayers.values()) {
    const result = profile.layout(doc, ids);
    Object.assign(ownLayout.positions, result.positions);
    Object.assign(ownLayout.sizes, result.sizes);
  }

  // Authored size (grown to a role box's content), else the text-measured estimate, else the flat default.
  const sizeOf = (element: CanvasElement) => {
    const measured = layoutBoxSize(element);
    return {
      width: measured?.w ?? DEFAULT_SIZE.width,
      height: measured?.h ?? DEFAULT_SIZE.height,
    };
  };
  // Measured sizes for the new boxes with no authored size, persisted so the renderer matches ELK.
  const measuredSizes = (ids: readonly string[]): Record<string, CanvasSize> => {
    const out: Record<string, CanvasSize> = {};
    for (const id of ids) {
      const element = doc.elements[id];
      if (!element || element.size) continue;
      const measured = measureBoxSize(element);
      if (measured) out[id] = measured;
    }
    return out;
  };
  const specOf = (element: CanvasElement) => ({
    id: element.id,
    ...sizeOf(element),
    order: orderMeta(element),
    lane: stringMeta(element, "lane"),
    laneKind: stringMeta(element, "lane_kind"),
    rank: stringMeta(element, "rank"),
  });

  const nodes = elkIds
    .map((id) => doc.elements[id])
    .filter((element): element is CanvasElement => Boolean(element))
    .map(specOf);

  // `existingElements.length === 0` is the real "nothing there yet" signal -- clamping the computed
  // max to 0 used to double as that check too, but a populated diagram sitting entirely above y=0
  // (bottom edge still negative) also clamps to 0, silently dropping yOffset and landing the next
  // diagram right on top of it instead of below it. Every fresh batch (epics or layered) shifts
  // below whatever already sits on the document, so this is computed once here.
  const existingElements = Object.values(doc.elements).filter(
    (element) => !newIdSet.has(element.id),
  );
  const yOffset =
    existingElements.length > 0
      ? Math.max(
          ...existingElements.map((element) => element.position.y + sizeOf(element).height / 2),
        ) + NEW_ELEMENTS_MARGIN
      : 0;

  // The epics diagram has no order/lane/edges, so the shared layered layout would pile every box at
  // (0,0) -- give it the deterministic per-EP column layout instead (010 Part 1 hard structure).
  if (isEpicsLayer(doc, newIds)) {
    const { positions: epicsPositions, sizes } = layoutEpics(doc, newIds);
    return {
      // The epics layer always reports fitted sizes (a drag never mutates them -- the boxes are
      // locked-layout), so no conditional spread is needed around them.
      sizes,
      positions: { ...applyYOffset(epicsPositions, yOffset), ...ownLayout.positions },
    };
  }

  // Incremental update: the layer already has placed boxes, so they stay exactly where they are and
  // only the new ones are placed next to them (follows the diagram if the user moved it).
  const layers = new Set(elkIds.map((id) => doc.elements[id]?.layer));
  const pinnedElements = Object.values(doc.elements).filter(
    (element) =>
      layers.has(element.layer) &&
      !newIdSet.has(element.id) &&
      !["group", "note", "question"].includes(element.render) &&
      !profileForElement(element).layout,
  );
  if (nodes.length > 0 && pinnedElements.length > 0) {
    const pinned = pinnedElements.map((element) => ({
      ...specOf(element),
      position: fixed[element.id] ?? element.position,
    }));
    const pinnedIds = new Set(pinned.map((box) => box.id));
    const inGraph = new Set([...pinnedIds, ...nodes.map((node) => node.id)]);
    const obstacles = existingElements
      .filter((element) => !pinnedIds.has(element.id) && element.render !== "group")
      .map((element) => {
        const { width, height } = sizeOf(element);
        const center = fixed[element.id] ?? element.position;
        return { id: element.id, x: center.x - width / 2, y: center.y - height / 2, width, height };
      });
    const positions = await placeIncrementally({
      pinned,
      added: nodes,
      edges: Object.values(doc.edges).filter((edge) => inGraph.has(edge.from) && inGraph.has(edge.to)),
      obstacles,
    });
    return {
      positions: { ...positions, ...ownLayout.positions },
      sizes: { ...measuredSizes(elkIds), ...ownLayout.sizes },
    };
  }

  const edges = Object.values(doc.edges)
    .filter((edge) => newIdSet.has(edge.from) && newIdSet.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }));

  const { boxes } = await layoutBoxes(nodes, edges);

  const positions: Record<string, CanvasPosition> = {};
  for (const box of boxes) {
    positions[box.id] = { x: box.x, y: box.y + yOffset };
  }
  // Profile-laid-out positions are self-contained, so they fold in unshifted, sizes alongside ELK's.
  return {
    positions: { ...positions, ...ownLayout.positions },
    sizes: { ...measuredSizes(elkIds), ...ownLayout.sizes },
  };
}

/** Shifts a positions map down by `yOffset`, returning a fresh map -- the one transformation every
 * `layoutNewElements` branch applies to its laid-out boxes without mutating the layout's own map. */
function applyYOffset(
  positions: Record<string, CanvasPosition>,
  yOffset: number,
): Record<string, CanvasPosition> {
  return Object.fromEntries(
    Object.entries(positions).map(([id, pos]) => [id, { x: pos.x, y: pos.y + yOffset }]),
  );
}
