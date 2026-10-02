import { describe, expect, it } from "vitest";
import { layoutNewElements } from "./autoLayout";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../state/types";

function element(id: string, y: number, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    render: "c1",
    layer: "c1",
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

function docWith(elements: CanvasElement[]): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((el) => [el.id, el])) };
}

describe("layoutNewElements", () => {
  it("places new elements below an existing diagram that sits entirely above y=0", () => {
    // Regression: an existing diagram's bottom edge can still be negative (e.g. -174) even though
    // it's a real, populated diagram, not an empty canvas -- clamping the offset calc to 0 in that
    // case used to drop it entirely, landing the new diagram right on top of the old one.
    const existing = element("old1", -200, { layer: "kv-cache-resource-check" });
    const doc = docWith([existing, element("new1", 0, { layer: "c1" })]);

    const positions = layoutNewElements(doc, ["new1"]);

    const existingBottom = existing.position.y + 72 / 2; // DEFAULT_SIZE.height
    expect(positions.new1.y).toBeGreaterThan(existingBottom);
  });

  it("does not shift a fresh diagram down when the canvas has no other elements", () => {
    const doc = docWith([element("new1", 0)]);

    const positions = layoutNewElements(doc, ["new1"]);

    // layoutBoxes's own margin, not pushed further down by a nonexistent "existing content" offset.
    expect(positions.new1.y).toBeLessThan(80);
  });
});
