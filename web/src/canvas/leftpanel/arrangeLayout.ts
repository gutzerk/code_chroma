export type ArrangeMode = "free" | "side" | "stack" | "grid";

export interface LayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DiagramBox {
  layer: string;
  bounds: LayoutRect;
}

export interface ArrangeRegion {
  originX: number;
  originY: number;
  rightEdge: number;
  bottomEdge: number;
}

export interface ArrangeResult {
  /** Per-layer translation (world units) to apply to every element of that layer. */
  offsets: Record<string, { dx: number; dy: number }>;
  /** The prototype's scale-to-fit factor; reported for callers that can scale, never applied to element sizes. */
  scale: number;
}

export const ARRANGE_GAP = 48;
export const ARRANGE_UNSELECTED_GAP = 120;
const GRID_COLUMNS = 2;

/** Bounding box of a set of rects, or null when empty. */
export function unionRects(rects: LayoutRect[]): LayoutRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

interface Slot {
  x: number;
  y: number;
}

function slotsFor(mode: Exclude<ArrangeMode, "free">, sizes: { w: number; h: number }[]): Slot[] {
  if (mode === "side") {
    let x = 0;
    return sizes.map((s) => {
      const slot = { x, y: 0 };
      x += s.w + ARRANGE_GAP;
      return slot;
    });
  }
  if (mode === "stack") {
    let y = 0;
    return sizes.map((s) => {
      const slot = { x: 0, y };
      y += s.h + ARRANGE_GAP;
      return slot;
    });
  }
  const cols = Math.min(GRID_COLUMNS, Math.max(1, sizes.length));
  const colW: number[] = Array(cols).fill(0);
  const rowH: number[] = [];
  sizes.forEach((s, i) => {
    colW[i % cols] = Math.max(colW[i % cols], s.w);
    const row = Math.floor(i / cols);
    rowH[row] = Math.max(rowH[row] ?? 0, s.h);
  });
  return sizes.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = colW.slice(0, col).reduce((sum, w) => sum + w + ARRANGE_GAP, 0);
    const y = rowH.slice(0, row).reduce((sum, h) => sum + h + ARRANGE_GAP, 0);
    return { x, y };
  });
}

/** Pure arrange math: slots the selected diagrams in the region and parks the rest 120 beyond them. */
export function computeArrangement(
  mode: Exclude<ArrangeMode, "free">,
  selected: DiagramBox[],
  unselected: DiagramBox[],
  region: ArrangeRegion,
): ArrangeResult {
  const offsets: ArrangeResult["offsets"] = {};
  if (selected.length === 0) return { offsets, scale: 1 };
  const sizes = selected.map((d) => ({ w: d.bounds.width, h: d.bounds.height }));
  const slots = slotsFor(mode, sizes);
  const bw = Math.max(...slots.map((s, i) => s.x + sizes[i].w));
  const bh = Math.max(...slots.map((s, i) => s.y + sizes[i].h));
  const vw = Math.max(1, region.rightEdge - region.originX);
  const vh = Math.max(1, region.bottomEdge - region.originY);
  const scale = Math.min(1, vw / bw, vh / bh);
  const startX = region.originX + Math.max(0, (vw - bw) / 2);
  const startY = region.originY + Math.max(0, (vh - bh) / 2);
  selected.forEach((d, i) => {
    offsets[d.layer] = {
      dx: startX + slots[i].x - d.bounds.left,
      dy: startY + slots[i].y - d.bounds.top,
    };
  });
  let y = startY;
  const parkX = startX + bw + ARRANGE_UNSELECTED_GAP;
  for (const d of unselected) {
    offsets[d.layer] = { dx: parkX - d.bounds.left, dy: y - d.bounds.top };
    y += d.bounds.height + ARRANGE_GAP;
  }
  return { offsets, scale };
}
