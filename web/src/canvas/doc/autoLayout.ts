import { layoutBoxes } from "../connectors/diagramLayout";
import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { orderMeta, stringMeta } from "./elementMeta";
import { isEpicsLayer, layoutEpics } from "./epicsLayout";
import { measureBoxSize } from "./measureBoxSize";
import { placeIncrementally } from "./incrementalLayout";
import { buildSequenceBoard } from "./sequenceBoard";
import type { SequenceView } from "./sequenceViewStore";

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
  // A sequence layer is laid out deterministically (layoutSequence below) -- never by ELK, whose
  // edge/order/lane model doesn't fit it. Split new elements by render so sequence leaves the
  // ELK path entirely and gets its own hard-layout pass (positions feed DiagramFrame/canvas-bounds
  // so the dashed frame hugs the real picture).
  const sequenceIds = newIds.filter((id) => doc.elements[id]?.render === "sequence");
  const nonSequenceIds = newIds.filter((id) => doc.elements[id]?.render !== "sequence");
  const sequenceLayout = layoutSequence(doc, sequenceIds);

  // Authored size wins, else the text-measured estimate, else the flat default (self-sized kinds).
  const sizeOf = (element: CanvasElement) => {
    const measured = measureBoxSize(element);
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

  const nodes = nonSequenceIds
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
      positions: { ...applyYOffset(epicsPositions, yOffset), ...sequenceLayout.positions },
    };
  }

  // Incremental update: the layer already has placed boxes, so they stay exactly where they are and
  // only the new ones are placed next to them (follows the diagram if the user moved it).
  const layers = new Set(nonSequenceIds.map((id) => doc.elements[id]?.layer));
  const pinnedElements = Object.values(doc.elements).filter(
    (element) =>
      layers.has(element.layer) &&
      !newIdSet.has(element.id) &&
      !["group", "note", "sequence", "question"].includes(element.render),
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
      positions: { ...positions, ...sequenceLayout.positions },
      sizes: { ...measuredSizes(nonSequenceIds), ...sequenceLayout.sizes },
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
  // Fold the sequence positions in (unshifted -- a sequence layer is self-contained; see
  // layoutSequence). Sequence sizes ride alongside ELK's unconditionally, like the epics branch
  // above (layoutSequence returns an empty sizes map when there are no sequence ids).
  return {
    positions: { ...positions, ...sequenceLayout.positions },
    sizes: { ...measuredSizes(nonSequenceIds), ...sequenceLayout.sizes },
  };
}

/** Deterministic positions/sizes for a sequence layer from `sequenceBoard.ts`'s swimlane layout, so
 * DiagramFrame and the canvas bounds hug the real picture. A participant is its lane (centre + full
 * lane size); a message is its step box. `view.expanded` grows the opened steps in place (display
 * only, see viewSequenceElements). Returns empty when there are no sequence ids. */
export function layoutSequence(
  doc: CanvasDoc,
  ids: readonly string[],
  view?: SequenceView,
): { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> } {
  const positions: Record<string, CanvasPosition> = {};
  const sizes: Record<string, CanvasSize> = {};
  if (ids.length === 0) return { positions, sizes };
  const elements = ids
    .map((id) => doc.elements[id])
    .filter((element): element is NonNullable<typeof element> => Boolean(element));
  const board = buildSequenceBoard(elements, view?.expanded ?? []);
  const place = (id: string, rect: { x: number; y: number; w: number; h: number }) => {
    positions[id] = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    sizes[id] = { w: rect.w, h: rect.h };
  };
  for (const lane of board.lanes) if (lane.participant) place(lane.participant.element.id, lane.rect);
  for (const step of board.steps) place(step.id, step.rect);
  return { positions, sizes };
}

/** The sequence layer's elements at the geometry the viewer's expanded steps imply, anchored to the
 * persisted layout so a frame drag survives; display only -- nothing here is written back. */
export function viewSequenceElements(
  doc: CanvasDoc,
  ids: readonly string[],
  view: SequenceView,
): CanvasElement[] {
  const elements = ids.map((id) => doc.elements[id]).filter((e): e is CanvasElement => Boolean(e));
  const base = layoutSequence(doc, ids);
  const next = view.expanded.length > 0 ? layoutSequence(doc, ids, view) : base;
  const anchor = elements.find((e) => base.positions[e.id]);
  if (!anchor) return elements;
  const dx = anchor.position.x - base.positions[anchor.id].x;
  const dy = anchor.position.y - base.positions[anchor.id].y;
  return elements.map((element) => {
    const p = next.positions[element.id];
    if (!p) return element;
    return { ...element, position: { x: p.x + dx, y: p.y + dy }, size: next.sizes[element.id] ?? element.size };
  });
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
