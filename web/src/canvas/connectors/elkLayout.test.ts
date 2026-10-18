import { describe, expect, it, vi } from "vitest";
import { computeElkLayout, type LayoutEdge } from "./elkLayout";
import { hasCollision } from "../collision/resolveDrop";
import type { LayoutBoxSpec, PositionedBox } from "./diagramLayout";

function box(id: string, order?: string, lane?: string): LayoutBoxSpec {
  return { id, width: 20, height: 10, order, lane };
}

function edge(from: string, to: string): LayoutEdge {
  return { from, to };
}

function boxOf(boxes: readonly PositionedBox[], id: string): PositionedBox {
  return boxes.find((b) => b.id === id) as PositionedBox;
}

function noOverlaps(boxes: readonly PositionedBox[]): boolean {
  return boxes.every((b, index) => {
    const rect = (o: PositionedBox) => ({ id: o.id, x: o.x - o.width / 2, y: o.y - o.height / 2, width: o.width, height: o.height });
    return !hasCollision(rect(b), boxes.filter((_, i) => i !== index).map(rect));
  });
}

describe("computeElkLayout", () => {
  it("returns fallback dimensions for empty input", async () => {
    expect(await computeElkLayout([], [])).toEqual({ boxes: [], width: 600, height: 400 });
  });

  it("is deterministic and non-overlapping on a chain plus a disconnected pair", async () => {
    const nodes = [box("a"), box("b"), box("c"), box("p1"), box("p2")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("p1", "p2")];

    const first = await computeElkLayout(nodes, edges);
    const second = await computeElkLayout(nodes, edges);

    expect(second.boxes).toEqual(first.boxes);
    expect(noOverlaps(first.boxes)).toBe(true);
  });

  it("keeps every source above its target along a chain and across a cycle", async () => {
    const nodes = [box("a"), box("b"), box("c")];

    const { boxes } = await computeElkLayout(nodes, [edge("a", "b"), edge("b", "c"), edge("c", "a")]);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    expect(boxOf(boxes, "b").y).toBeLessThan(boxOf(boxes, "c").y);
  });

  it("skips self-loops, duplicates and edges to missing ids", async () => {
    const nodes = [box("a"), box("b")];
    const edges = [edge("a", "a"), edge("a", "b"), edge("a", "b"), edge("a", "missing")];

    const { boxes } = await computeElkLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
  });

  it("lets authored order override topology", async () => {
    const { boxes } = await computeElkLayout([box("a", "1"), box("b", "2")], [edge("b", "a")]);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
  });

  it("parses only the leading digit run and treats an unparseable order as unset", async () => {
    const nodes = [box("s"), box("a", "12a"), box("b", "3"), box("x", "abc")];

    const { boxes } = await computeElkLayout(nodes, [edge("s", "a"), edge("s", "b"), edge("x", "s")]);

    expect(boxOf(boxes, "b").y).toBeLessThan(boxOf(boxes, "a").y);
  });

  it("clamps order \"0\" to the same layer as \"1\" with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { boxes } = await computeElkLayout([box("a", "0"), box("b", "1"), box("c")], [edge("a", "c"), edge("b", "c")]);

    expect(boxOf(boxes, "a").y).toEqual(boxOf(boxes, "b").y);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('meta.order "0"'));
    warn.mockRestore();
  });

  it("clusters same-lane boxes adjacent within a layer", async () => {
    const nodes = [box("a", undefined, "ops"), box("b"), box("c", undefined, "ops"), box("d")];
    const edges = [edge("a", "d"), edge("b", "d"), edge("c", "d")];

    const { boxes } = await computeElkLayout(nodes, edges);

    const xs = ["a", "b", "c"].map((id) => ({ id, x: boxOf(boxes, id).x })).sort((p, q) => p.x - q.x);
    expect(xs.map((p) => p.id).join("")).toMatch(/^(ac|ca)b$|^b(ac|ca)$/);
  });
});
