import { describe, expect, it } from "vitest";
import { findUnplaced } from "./pileLayout";
import { EMPTY_CANVAS_DOC, type CanvasDoc } from "../../state/types";

function box(id: string, layer: string, x: number, y: number) {
  return {
    id, render: "custom" as const, layer, label: id, description: "", node_id: null,
    position: { x, y }, size: null, group_id: null, meta: {}, created_by: "ai" as const,
  };
}

function docOf(...boxes: ReturnType<typeof box>[]): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(boxes.map((b) => [b.id, b])) };
}

describe("findUnplaced", () => {
  const none = new Set<string>();

  it("returns every box of a layer that is wholly on the origin", () => {
    const doc = docOf(box("a", "x", 0, 0), box("b", "x", 0, 0));

    expect(findUnplaced(doc, none, none)).toEqual({ x: ["a", "b"] });
  });

  it("returns only the new box of an already laid-out layer", () => {
    const doc = docOf(box("a", "x", 300, 0), box("b", "x", 0, 200), box("c", "x", 0, 0));

    expect(findUnplaced(doc, none, none)).toEqual({ x: ["c"] });
  });

  it.each([
    ["a lone box", [box("a", "x", 0, 0)], none, none],
    ["the hierarchy layer", [box("a", "hierarchy", 0, 0), box("b", "hierarchy", 0, 0)], none, none],
    ["a skipped layer", [box("a", "x", 0, 0), box("b", "x", 0, 0)], new Set(["x"]), none],
    ["boxes already auto-placed", [box("a", "x", 0, 0), box("b", "x", 5, 5)], none, new Set(["a"])],
  ])("ignores %s", (_name, boxes, skip, done) => {
    expect(findUnplaced(docOf(...boxes), skip, done)).toEqual({});
  });
});
