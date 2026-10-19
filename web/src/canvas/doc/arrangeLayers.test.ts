import { describe, expect, it } from "vitest";
import { arrangeLayers } from "./arrangeLayers";
import { unionBoundsOf } from "./boundingBox";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../state/types";

function el(id: string, layer: string, x: number, y: number): CanvasElement {
  return {
    id, render: "custom", layer, label: id, description: "", node_id: null,
    position: { x, y }, size: { w: 100, h: 50 }, group_id: null, meta: {}, created_by: "ai",
  };
}

function docOf(elements: CanvasElement[]): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((e) => [e.id, e])) };
}

function apply(doc: CanvasDoc, moves: Array<{ id: string; position: { x: number; y: number } }>): CanvasElement[] {
  return Object.values(doc.elements).map((e) => ({ ...e, position: moves.find((m) => m.id === e.id)?.position ?? e.position }));
}

function bounds(members: CanvasElement[]) {
  return unionBoundsOf(members, new Map())!;
}

const BASE = [
  el("a1", "A", 50, 25), el("a2", "A", 250, 125),
  el("b1", "B", 1000, 1000),
  el("c1", "C", 2000, 0),
  el("u1", "U", 500, 500),
];

describe("arrangeLayers", () => {
  it("lays selected layers out as a row for side", () => {
    const doc = docOf(BASE);

    const { moves } = arrangeLayers({ doc, selectedLayers: ["B", "A"], hiddenLayers: [], mode: "side" });

    const next = apply(doc, moves);
    const b = bounds(next.filter((e) => e.layer === "B"));
    const a = bounds(next.filter((e) => e.layer === "A"));
    expect(a.left - b.right).toBe(80);
    expect(a.top).toBe(b.top);
  });

  it("lays selected layers out as a column for stack", () => {
    const doc = docOf(BASE);

    const { moves } = arrangeLayers({ doc, selectedLayers: ["A", "B"], hiddenLayers: [], mode: "stack" });

    const next = apply(doc, moves);
    const a = bounds(next.filter((e) => e.layer === "A"));
    const b = bounds(next.filter((e) => e.layer === "B"));
    expect(b.top - a.bottom).toBe(80);
    expect(b.left).toBe(a.left);
  });

  it("uses ceil(sqrt(n)) columns for grid", () => {
    const doc = docOf(BASE);

    const { moves, packedBounds } = arrangeLayers({ doc, selectedLayers: ["A", "B", "C"], hiddenLayers: [], mode: "grid" });

    const next = apply(doc, moves);
    const c = bounds(next.filter((e) => e.layer === "C"));
    const a = bounds(next.filter((e) => e.layer === "A"));
    expect(c.left).toBe(a.left);
    expect(c.top).toBeGreaterThan(a.bottom);
    expect(packedBounds.left).toBe(a.left);
  });

  it("keeps members' relative offsets rigid", () => {
    const doc = docOf(BASE);

    const { moves } = arrangeLayers({ doc, selectedLayers: ["B", "A"], hiddenLayers: [], mode: "side" });

    const p = (id: string) => moves.find((m) => m.id === id)!.position;
    expect(p("a2").x - p("a1").x).toBe(200);
    expect(p("a2").y - p("a1").y).toBe(100);
  });

  it("starts at the selected union's top-left", () => {
    const doc = docOf(BASE);

    const { packedBounds } = arrangeLayers({ doc, selectedLayers: ["A", "B"], hiddenLayers: [], mode: "side" });

    expect(packedBounds.left).toBe(0);
    expect(packedBounds.top).toBe(0);
  });

  it("places unselected layers below for side and beside for stack", () => {
    const doc = docOf(BASE);

    const side = arrangeLayers({ doc, selectedLayers: ["A", "B"], hiddenLayers: [], mode: "side" });
    const stack = arrangeLayers({ doc, selectedLayers: ["A", "B"], hiddenLayers: [], mode: "stack" });

    const sideU = bounds(apply(doc, side.moves).filter((e) => e.layer === "U"));
    const stackU = bounds(apply(doc, stack.moves).filter((e) => e.layer === "U"));
    expect(sideU.top).toBe(side.packedBounds.top + side.packedBounds.height + 80);
    expect(stackU.left).toBe(stack.packedBounds.left + stack.packedBounds.width + 80);
  });

  it("ignores hidden, hierarchy and default layers", () => {
    const doc = docOf([...BASE, el("h1", "hierarchy", 9, 9), el("d1", "default", 9, 9)]);

    const { moves } = arrangeLayers({ doc, selectedLayers: ["A", "C"], hiddenLayers: ["B"], mode: "side" });

    const ids = moves.map((m) => m.id);
    expect(ids).not.toContain("b1");
    expect(ids).not.toContain("h1");
    expect(ids).not.toContain("d1");
    expect(ids).toContain("u1");
  });

  it("leaves no overlapping layers in any mode", () => {
    const doc = docOf(BASE);

    for (const mode of ["side", "stack", "grid"] as const) {
      const { moves } = arrangeLayers({ doc, selectedLayers: ["A", "B", "C"], hiddenLayers: [], mode });
      const next = apply(doc, moves);
      const boxes = ["A", "B", "C", "U"].map((l) => bounds(next.filter((e) => e.layer === l)));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const x = boxes[i];
          const y = boxes[j];
          const overlap = x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("returns no moves when nothing is selected", () => {
    const doc = docOf(BASE);

    const { moves } = arrangeLayers({ doc, selectedLayers: [], hiddenLayers: [], mode: "side" });

    expect(moves).toEqual([]);
  });
});
