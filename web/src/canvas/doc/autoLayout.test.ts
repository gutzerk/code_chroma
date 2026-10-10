import { describe, expect, it } from "vitest";
import { layoutNewElements } from "./autoLayout";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasEdge, type CanvasElement } from "../../state/types";

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

function sequenceEl(id: string, role: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return element(id, 0, { render: "sequence", layer: "sequence", meta: { role }, ...overrides });
}

describe("layoutNewElements", () => {
  it("lays a sequence layer out by columns and time-rows, not ELK", async () => {
    const doc = docWith([
      sequenceEl("p1", "participant", { label: "Client", meta: { role: "participant", recipe_key: "client" } }),
      sequenceEl("p2", "participant", { label: "API", meta: { role: "participant", recipe_key: "api" } }),
      sequenceEl("m1", "message", { label: "m1", meta: { role: "message", from: "client", to: "api", order: "1" } }),
      sequenceEl("m2", "message", { label: "m2", meta: { role: "message", from: "api", to: "client", order: "2", return: "true" } }),
    ]);

    const { positions, sizes } = await layoutNewElements(doc, ["p1", "p2", "m1", "m2"]);

    // Participants sit in columns (x = col * colW(260) + 130); messages between their columns.
    expect(positions.p1.x).toBe(130);
    expect(positions.p2.x).toBe(390);
    expect(positions.m1.x).toBe(260);
    expect(positions.m2.x).toBe(260);
    // Rows: message `order` 1 at headH + rowH/2, `order` 2 one row lower.
    expect(positions.m1.y).toBeLessThan(positions.m2.y);
    // Sequence elements get explicit sizes so DiagramFrame/canvas bounds hug the picture, and the
    // head width is capped below the column so adjacent name boxes never touch.
    expect(sizes?.p1).toEqual({ w: 180, h: 36 });
    expect(positions.p2.x - positions.p1.x).toBeGreaterThan(180);
  });

  it("places new elements below an existing diagram that sits entirely above y=0", async () => {
    // Regression: an existing diagram's bottom edge can still be negative (e.g. -174) even though
    // it's a real, populated diagram, not an empty canvas -- clamping the offset calc to 0 in that
    // case used to drop it entirely, landing the new diagram right on top of the old one.
    const existing = element("old1", -200, { layer: "kv-cache-resource-check" });
    const doc = docWith([existing, element("new1", 0, { layer: "c1" })]);

    const { positions } = await layoutNewElements(doc, ["new1"]);

    const existingBottom = existing.position.y + 72 / 2; // DEFAULT_SIZE.height
    expect(positions.new1.y).toBeGreaterThan(existingBottom);
  });

  it("does not shift a fresh diagram down when the canvas has no other elements", async () => {
    const doc = docWith([element("new1", 0)]);

    const { positions } = await layoutNewElements(doc, ["new1"]);

    // layoutBoxes's own margin, not pushed further down by a nonexistent "existing content" offset.
    expect(positions.new1.y).toBeLessThan(80);
  });

  it("packs many new blocks into a compact grid instead of one endless row", async () => {
    // Regression: blocks of a freshly-drawn diagram share a 300x72 footprint, so with NODE_SEP=110
    // a row holds ~5 of them before exceeding the row width. When that wrap was broken/lowered the
    // whole batch spilled into a single 2000px+ horizontal band (the "new diagram spreads blocks
    // far apart" bug) instead of wrapping onto a second row.
    const count = 9;
    const newIds = Array.from({ length: count }, (_, i) => `b${i}`);
    const doc = docWith(newIds.map((id) => element(id, 0)));

    const { positions } = await layoutNewElements(doc, newIds);

    const xs = newIds.map((id) => positions[id].x);
    const ys = newIds.map((id) => positions[id].y);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // A row of ~5 * (300 + NODE_SEP) + margin stays comfortably under 2400 -- a wrapped grid must
    // never reach the old single-row width. Keep the bound tight enough to catch a lost wrap.
    expect(maxX).toBeLessThan(2000);
    // A wrapped layout has more than one distinct row.
    expect(maxY - minY).toBeGreaterThan(0);
  });
});

function edgeOf(from: string, to: string): CanvasEdge {
  return { id: `${from}-${to}`, from, to, label: "", kind: "uses", layer: "c1" };
}

describe("layoutNewElements on an incremental update", () => {
  function docAt(dx: number, dy: number): CanvasDoc {
    const placed = [
      element("a", 0, { position: { x: 300 + dx, y: 100 + dy } }),
      element("b", 0, { position: { x: 300 + dx, y: 400 + dy } }),
    ];
    return {
      ...docWith([...placed, element("n", 0)]),
      edges: { "a-b": edgeOf("a", "b"), "b-n": edgeOf("b", "n") },
    };
  }

  it("positions only the new element, never the placed ones", async () => {
    const { positions } = await layoutNewElements(docAt(0, 0), ["n"]);

    expect(Object.keys(positions)).toEqual(["n"]);
  });

  it("puts a new element below the placed box it is wired from", async () => {
    const { positions } = await layoutNewElements(docAt(0, 0), ["n"]);

    expect(positions.n.y).toBeGreaterThan(400);
  });

  it("follows a diagram the user dragged far away", async () => {
    const { positions } = await layoutNewElements(docAt(5000, 3000), ["n"]);

    expect(positions.n.x).toBeGreaterThan(4000);
    expect(positions.n.y).toBeGreaterThan(3400);
  });

  it("never lands on top of a placed box", async () => {
    const doc = docAt(0, 0);
    doc.elements.n.layer = "c1";
    const blocker = element("blocker", 0, { layer: "other", position: { x: 300, y: 700 } });
    doc.elements.blocker = blocker;

    const { positions } = await layoutNewElements(doc, ["n"]);

    const clear = Math.abs(positions.n.x - 300) >= 300 || Math.abs(positions.n.y - 700) >= 72;
    expect(clear).toBe(true);
  });

  it("uses fixed positions for kept elements that are about to be restored", async () => {
    const doc = docAt(0, 0);

    const { positions } = await layoutNewElements(doc, ["n"], {
      a: { x: 300, y: 2100 },
      b: { x: 300, y: 2400 },
    });

    expect(positions.n.y).toBeGreaterThan(2400);
  });
});
