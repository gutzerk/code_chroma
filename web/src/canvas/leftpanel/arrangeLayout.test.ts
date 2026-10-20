import { describe, expect, it } from "vitest";
import { computeArrangement, unionRects, type DiagramBox } from "./arrangeLayout";

const region = { originX: 0, originY: 0, rightEdge: 1000, bottomEdge: 800 };
const box = (layer: string, left: number, top: number, w: number, h: number): DiagramBox => ({
  layer,
  bounds: { left, top, width: w, height: h },
});

describe("computeArrangement", () => {
  it("places two diagrams side by side with a 48 gap", () => {
    const result = computeArrangement("side", [box("a", 100, 100, 200, 100), box("b", 0, 0, 100, 50)], [], region);

    expect(result.offsets.a).toEqual({ dx: 226, dy: 250 });
    expect(result.offsets.b).toEqual({ dx: 326 + 248, dy: 350 });
  });

  it("stacks diagrams vertically", () => {
    const result = computeArrangement("stack", [box("a", 0, 0, 100, 100), box("b", 0, 0, 100, 100)], [], {
      ...region,
      rightEdge: 100,
      bottomEdge: 248,
    });

    expect(result.offsets.b.dy - result.offsets.a.dy).toBe(148);
    expect(result.offsets.b.dx).toBe(result.offsets.a.dx);
  });

  it("wraps a grid after two columns", () => {
    const boxes = ["a", "b", "c"].map((l) => box(l, 0, 0, 100, 100));

    const { offsets } = computeArrangement("grid", boxes, [], { ...region, rightEdge: 248, bottomEdge: 248 });

    expect(offsets.b.dx).toBe(148);
    expect(offsets.c).toEqual({ dx: 0, dy: 148 });
  });

  it("parks unselected diagrams 120 beyond the arranged block and reports the fit scale", () => {
    const result = computeArrangement("side", [box("a", 0, 0, 2000, 100)], [box("u", 0, 0, 50, 50)], region);

    expect(result.offsets.u.dx).toBe(2000 + 120);
    expect(result.scale).toBe(0.5);
  });

  it("returns nothing for an empty selection", () => {
    expect(computeArrangement("grid", [], [], region).offsets).toEqual({});
  });
});

describe("unionRects", () => {
  it("returns the bounding box", () => {
    expect(
      unionRects([
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 20, top: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 0, top: 0, width: 30, height: 15 });
  });
});
