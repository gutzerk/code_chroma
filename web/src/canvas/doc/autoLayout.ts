import { layoutBoxes } from "../connectors/diagramLayout";
import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { rawMeta, stringMeta } from "./elementMeta";
import { isEpicsLayer, layoutEpics } from "./epicsLayout";
import { placeIncrementally } from "./incrementalLayout";

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

  const sizeOf = (element: CanvasElement) => ({
    width: element.size?.w ?? DEFAULT_SIZE.width,
    height: element.size?.h ?? DEFAULT_SIZE.height,
  });
  const specOf = (element: CanvasElement) => ({
    id: element.id,
    ...sizeOf(element),
    order: stringMeta(element, "order"),
    lane: stringMeta(element, "lane"),
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
      !["group", "note", "sequence"].includes(element.render),
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
    return { positions: { ...positions, ...sequenceLayout.positions }, sizes: sequenceLayout.sizes };
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
    sizes: sequenceLayout.sizes,
  };
}

/** Same layout constants the SequenceDiagram component uses -- keep the two in sync by hand.
 * `colW` is deliberately wider than the participant head (`headW`) so adjacent name boxes always
 * keep a real gap (head 180 in a 260 column → ~80px of air), never touching. `rowH` is the centre-
 * to-centre spacing of message rows; `headGap` (air between the participant heads and the first
 * message line) comes from a position shift, while the gap below the last line is the dashed
 * DiagramFrame's own `PADDING.bottom` (DiagramFrame.tsx) -- never fake it by fattening a message's
 * `size.h`, which would poke the outer rows up into the heads. */
export const SEQUENCE_LAYOUT = {
  colW: 260,
  headH: 36,
  headW: 180,
  rowH: 58,
  headGap: 26,
};

/** Deterministic positions/sizes for a fresh sequence layer, derived from `meta` just like
 * SequenceDiagram draws it, so DiagramFrame and the canvas bounds hug the real picture instead of
 * a corner pile (the elements are locked-layout; this only names each participant/message's spot).
 * Participants sit in columns left-to-right (x = column * colW); every message sits on its own time
 * row (y = headH + headGap + rowH * (order - 1)) at the midpoint between its two columns. The first
 * row is pushed `headGap` below the participant heads; the gap below the last line is DiagramFrame's
 * own bottom padding (see SEQUENCE_LAYOUT). Returns empty when there are no sequence ids (the ELK
 * path is the only active one). */
export function layoutSequence(
  doc: CanvasDoc,
  ids: readonly string[],
): { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> } {
  const positions: Record<string, CanvasPosition> = {};
  const sizes: Record<string, CanvasSize> = {};
  if (ids.length === 0) return { positions, sizes };

  const elements = ids
    .map((id) => doc.elements[id])
    .filter((element): element is NonNullable<typeof element> => Boolean(element));

  // Participant columns (left-to-right, in element order) and their authored-id → column index.
  const participants = elements.filter((e) => stringMeta(e, "role") === "participant");
  const colByRef = new Map<string, number>();
  participants.forEach((element, index) => {
    colByRef.set(element.id, index);
    const key = stringMeta(element, "recipe_key");
    if (key) colByRef.set(key, index);
  });

  participants.forEach((element, index) => {
    const x = index * SEQUENCE_LAYOUT.colW + SEQUENCE_LAYOUT.colW / 2;
    positions[element.id] = { x, y: SEQUENCE_LAYOUT.headH };
    // Center-anchored box (CanvasNodeBox positions by center). A participant head is a fixed,
    // capped width (`headW`) that never exceeds its column, so adjacent heads always keep a gap.
    sizes[element.id] = { w: SEQUENCE_LAYOUT.headW, h: SEQUENCE_LAYOUT.headH };
  });

  for (const element of elements) {
    if (stringMeta(element, "role") !== "message") continue;
    const order = Number(rawMeta(element, "order"));
    const x1 = colByRef.get(String(rawMeta(element, "from") ?? ""));
    const x2 = colByRef.get(String(rawMeta(element, "to") ?? ""));
    if (!Number.isFinite(order) || x1 === undefined || x2 === undefined) continue;
    const y =
      SEQUENCE_LAYOUT.headH +
      SEQUENCE_LAYOUT.headGap +
      SEQUENCE_LAYOUT.rowH * (order - 1) +
      SEQUENCE_LAYOUT.rowH / 2;
    const xMid = (x1 * SEQUENCE_LAYOUT.colW + x2 * SEQUENCE_LAYOUT.colW) / 2 + SEQUENCE_LAYOUT.colW / 2;
    positions[element.id] = { x: xMid, y };
    // A message keeps a thin row footprint (height = rowH). The vertical air comes from position,
    // not a fattened size: `headGap` pushes the very first line clear of the participant heads, while
    // the gap below the last line is the dashed DiagramFrame's own padding (DiagramFrame.tsx's
    // PADDING.bottom). Inflating `size.h` here made the outer message rects poke up into the heads and
    // pinch the bottom arrow against the frame -- don't fatten it.
    sizes[element.id] = { w: 40, h: SEQUENCE_LAYOUT.rowH };
  }
  return { positions, sizes };
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
