import type { CanvasDoc, CanvasElement } from "../../state/types";
import type { Rect } from "../connectors/orthogonalRoute";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { unionBoundsOf } from "./boundingBox";
import { isDiagramLayer } from "./diagramCatalog";

export type ArrangeLayout = "side" | "stack" | "grid";

export interface ArrangeMove {
  id: string;
  position: { x: number; y: number };
}

export interface ArrangeInput {
  doc: CanvasDoc;
  selectedLayers: readonly string[];
  hiddenLayers: readonly string[];
  mode: ArrangeLayout;
  gap?: number;
  sizes?: ReadonlyMap<string, MeasuredBoxSize>;
}

interface LayerBox {
  members: CanvasElement[];
  left: number;
  top: number;
  width: number;
  height: number;
}

function collectLayers(doc: CanvasDoc, hidden: ReadonlySet<string>): Map<string, CanvasElement[]> {
  const layers = new Map<string, CanvasElement[]>();
  for (const el of Object.values(doc.elements)) {
    if (!isDiagramLayer(el.layer) || hidden.has(el.layer)) continue;
    const list = layers.get(el.layer);
    if (list) list.push(el);
    else layers.set(el.layer, [el]);
  }
  return layers;
}

function measure(members: CanvasElement[], sizes?: ReadonlyMap<string, MeasuredBoxSize>): LayerBox {
  const b = unionBoundsOf(members, sizes ?? new Map())!;
  return { members, left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top };
}

/** Slot top-left for each box, flowing as a row, a column or a ceil(sqrt(n))-column grid. */
function slots(boxes: LayerBox[], mode: ArrangeLayout, origin: { x: number; y: number }, gap: number) {
  const cols = mode === "side" ? boxes.length : mode === "stack" ? 1 : Math.ceil(Math.sqrt(boxes.length));
  const rows = Math.ceil(boxes.length / Math.max(cols, 1));
  const colW = Array<number>(cols).fill(0);
  const rowH = Array<number>(rows).fill(0);
  boxes.forEach((box, i) => {
    colW[i % cols] = Math.max(colW[i % cols], box.width);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], box.height);
  });
  const colX = colW.map((_, c) => origin.x + colW.slice(0, c).reduce((s, w) => s + w + gap, 0));
  const rowY = rowH.map((_, r) => origin.y + rowH.slice(0, r).reduce((s, h) => s + h + gap, 0));
  const out = boxes.map((_, i) => ({ x: colX[i % cols], y: rowY[Math.floor(i / cols)] }));
  const width = colW.reduce((s, w) => s + w, 0) + gap * (cols - 1);
  const height = rowH.reduce((s, h) => s + h, 0) + gap * (rows - 1);
  return { out, width, height };
}

/** Packs the selected diagram layers rigidly (members keep relative offsets) and parks the rest after them. */
export function arrangeLayers(input: ArrangeInput): { moves: ArrangeMove[]; packedBounds: Rect } {
  const { doc, selectedLayers, hiddenLayers, mode, gap = 80, sizes } = input;
  const layers = collectLayers(doc, new Set(hiddenLayers));
  const selectedIds = [...new Set(selectedLayers)].filter((l) => layers.has(l));
  const selected = selectedIds.map((l) => measure(layers.get(l)!, sizes));
  const rest = [...layers.keys()].filter((l) => !selectedIds.includes(l)).map((l) => measure(layers.get(l)!, sizes));
  if (selected.length === 0) return { moves: [], packedBounds: { left: 0, top: 0, width: 0, height: 0 } };

  const origin = {
    x: Math.min(...selected.map((b) => b.left)),
    y: Math.min(...selected.map((b) => b.top)),
  };
  const packed = slots(selected, mode, origin, gap);
  const targets: Array<[LayerBox, { x: number; y: number }]> = selected.map((b, i) => [b, packed.out[i]]);

  if (rest.length > 0) {
    // Unselected diagrams go below (side/grid) or beside (stack) the packed block, as a row or a column.
    const restOrigin =
      mode === "stack"
        ? { x: origin.x + packed.width + gap, y: origin.y }
        : { x: origin.x, y: origin.y + packed.height + gap };
    const placed = slots(rest, mode === "stack" ? "stack" : "side", restOrigin, gap);
    rest.forEach((b, i) => targets.push([b, placed.out[i]]));
  }

  const moves: ArrangeMove[] = [];
  for (const [box, target] of targets) {
    const dx = target.x - box.left;
    const dy = target.y - box.top;
    for (const el of box.members) moves.push({ id: el.id, position: { x: el.position.x + dx, y: el.position.y + dy } });
  }
  return { moves, packedBounds: { left: origin.x, top: origin.y, width: packed.width, height: packed.height } };
}
