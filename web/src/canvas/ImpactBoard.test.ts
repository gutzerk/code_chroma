import { describe, expect, it } from "vitest";
import { impactBoundsOf, liveImpactBounds } from "./ImpactBoard";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../state/types";

function box(id: string, x: number, y: number, layer = "impact"): CanvasElement {
  return {
    id,
    render: "impact",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x, y },
    size: { w: 100, h: 50 },
    group_id: null,
    meta: {},
    created_by: "ai",
  };
}

function docOf(elements: CanvasElement[]): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((element) => [element.id, element])) };
}

describe("liveImpactBounds", () => {
  it("shifts the board bounds by an in-flight drag of the impact layer", () => {
    const doc = docOf([box("a", 100, 100), box("b", 300, 100)]);
    const saved = impactBoundsOf(doc)!;

    const live = liveImpactBounds(doc, { a: { x: 40, y: 20 }, b: { x: 40, y: 20 } });

    expect(live).toEqual({ ...saved, left: saved.left + 40, top: saved.top + 20 });
  });

  it("ignores a drag of an element outside the impact layer", () => {
    const doc = docOf([box("a", 100, 100), box("note", 0, 0, "notes")]);

    const live = liveImpactBounds(doc, { note: { x: 500, y: 500 } });

    expect(live).toBe(impactBoundsOf(doc));
  });
});
