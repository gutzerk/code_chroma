import { describe, expect, it, vi } from "vitest";
import { computeLayeredLayout, type LayoutEdge } from "./layeredLayout";
import { hasCollision } from "../collision/resolveDrop";
import type { LayoutBoxSpec, PositionedBox } from "./diagramLayout";

function box(id: string, width = 20, height = 10, order?: string, lane?: string): LayoutBoxSpec {
  return { id, width, height, order, lane };
}

function edge(from: string, to: string, kind?: string): LayoutEdge {
  return kind ? { from, to, kind } : { from, to };
}

function boxOf(boxes: readonly PositionedBox[], id: string): PositionedBox {
  return boxes.find((b) => b.id === id) as PositionedBox;
}

function noOverlaps(boxes: readonly PositionedBox[]): boolean {
  return boxes.every((box, index) => {
    const moving = { x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height };
    const obstacles = boxes
      .filter((_, otherIndex) => otherIndex !== index)
      .map((other) => ({
        id: other.id,
        x: other.x - other.width / 2,
        y: other.y - other.height / 2,
        width: other.width,
        height: other.height,
      }));
    return !hasCollision(moving, obstacles);
  });
}

describe("computeLayeredLayout", () => {
  it("places every input node exactly once, with sane fallback dimensions for empty input", () => {
    const empty = computeLayeredLayout([], []);

    expect(empty).toEqual({ boxes: [], width: 600, height: 400 });
  });

  it("returns non-overlapping boxes on a mixed graph of a chain plus a disconnected pair", () => {
    const nodes = [box("a"), box("b"), box("c"), box("d"), box("p1"), box("p2")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("b", "d"), edge("p1", "p2")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxes.map((b) => b.id).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(noOverlaps(boxes)).toBe(true);
  });

  it("returns identical positions when called twice with identical input", () => {
    const nodes = [box("a"), box("b"), box("c"), box("iso1"), box("iso2")];
    const edges = [edge("a", "b"), edge("a", "c")];

    const first = computeLayeredLayout(nodes, edges);
    const second = computeLayeredLayout(nodes, edges);

    expect(second.boxes).toEqual(first.boxes);
  });

  it("places the source strictly above the target for a one-directional edge", () => {
    const nodes = [box("a"), box("b")];
    const edges = [edge("a", "b")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
  });

  it("keeps every source above its target across a longer directed chain", () => {
    const nodes = [box("a"), box("b"), box("c"), box("d")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    expect(boxOf(boxes, "b").y).toBeLessThan(boxOf(boxes, "c").y);
    expect(boxOf(boxes, "c").y).toBeLessThan(boxOf(boxes, "d").y);
  });

  it("does not stretch a diamond's sink past one rank below its lower-ranked parent", () => {
    const nodes = [box("a"), box("b"), box("c"), box("d")];
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "c").y);
    expect(boxOf(boxes, "b").y).toEqual(boxOf(boxes, "c").y);
    expect(boxOf(boxes, "d").y).toBeGreaterThan(boxOf(boxes, "b").y);
    expect(boxOf(boxes, "d").y).toBeGreaterThan(boxOf(boxes, "c").y);
  });

  it("does not crash or contradict itself on a two-node cycle (no single flow direction)", () => {
    const nodes = [box("a"), box("b")];
    const edges = [edge("a", "b"), edge("b", "a")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxes.map((b) => b.id).sort()).toEqual(["a", "b"]);
    expect(noOverlaps(boxes)).toBe(true);
  });

  it("still ranks the rest of a longer cycle by direction outside the back-edge", () => {
    const nodes = [box("a"), box("b"), box("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    expect(boxOf(boxes, "b").y).toBeLessThan(boxOf(boxes, "c").y);
  });

  it("treats duplicate A-to-B edges (different kinds) as a single structural edge", () => {
    const nodes = [box("a"), box("b")];
    const edges = [edge("a", "b", "uses"), edge("a", "b", "notifies")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
  });

  it("drops a self-loop from ranking without crashing", () => {
    const nodes = [box("a"), box("b")];
    const edges = [edge("a", "a"), edge("a", "b")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(boxes.map((b) => b.id).sort()).toEqual(["a", "b"]);
    expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
  });

  it("packs disconnected components without overlap", () => {
    const nodes = [box("h"), box("l1"), box("l2"), box("iso1"), box("iso2"), box("iso3")];
    const edges = [edge("h", "l1"), edge("h", "l2")];

    const { boxes } = computeLayeredLayout(nodes, edges);

    expect(noOverlaps(boxes)).toBe(true);
  });

  // 054-diagram-flow-order: an authored `order` decides a box's rank directly, instead of only
  // sorting within a rank the topology already assigned.
  describe("authored order", () => {
    it("overrides topology when the two disagree", () => {
      const nodes = [box("a", 20, 10, "1"), box("b", 20, 10, "2")];
      // The edge alone would put b above a ("source above target") -- order says the opposite.
      const edges = [edge("b", "a")];

      const { boxes } = computeLayeredLayout(nodes, edges);

      expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    });

    it("keeps an order-less box on its topological rank alongside order-carrying siblings", () => {
      const nodes = [box("vm", 20, 10, "1"), box("cp", 20, 10, "2"), box("cert", 20, 10, "3"), box("secret")];
      // "secret" carries no order -- it's a supporting fact the numbered flow reads from, not a step.
      const edges = [edge("vm", "cp"), edge("cp", "cert"), edge("secret", "cp")];

      const { boxes } = computeLayeredLayout(nodes, edges);

      expect(boxOf(boxes, "secret").y).toEqual(boxOf(boxes, "vm").y);
      expect(boxOf(boxes, "cp").y).toBeGreaterThan(boxOf(boxes, "vm").y);
      expect(boxOf(boxes, "cert").y).toBeGreaterThan(boxOf(boxes, "cp").y);
    });

    it("parses only the leading digit run of an order value", () => {
      const nodes = [box("s"), box("a", 20, 10, "12a"), box("b", 20, 10, "3")];
      const edges = [edge("s", "a"), edge("s", "b")];

      const { boxes } = computeLayeredLayout(nodes, edges);

      expect(boxOf(boxes, "b").y).toBeLessThan(boxOf(boxes, "a").y);
      expect(boxOf(boxes, "s").y).toBeLessThan(boxOf(boxes, "b").y);
    });

    it("treats an unparseable order value as unset, without crashing", () => {
      const nodes = [box("a", 20, 10, "abc"), box("b")];
      const edges = [edge("a", "b")];

      const { boxes } = computeLayeredLayout(nodes, edges);

      expect(boxOf(boxes, "a").y).toBeLessThan(boxOf(boxes, "b").y);
    });

    it("clamps an out-of-range order of \"0\" to the same rank as \"1\", with a console warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const nodes = [box("a", 20, 10, "0"), box("b", 20, 10, "1")];

      const { boxes } = computeLayeredLayout(nodes, []);

      expect(boxOf(boxes, "a").y).toEqual(boxOf(boxes, "b").y);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('meta.order "0"'));
      warn.mockRestore();
    });
  });

  // 054-diagram-flow-order: boxes sharing a Lane cluster adjacent within one rank, ahead of the
  // existing barycenter/degree/id tie-break.
  describe("authored lane", () => {
    it("clusters same-lane boxes adjacent within a rank", () => {
      // A shared child "d" pulls a/b/c into one component (all rank 0) without ranking them
      // relative to each other, so this isolates lane clustering from the barycenter/degree pass.
      const nodes = [box("a", 20, 10, undefined, "ops"), box("b"), box("c", 20, 10, undefined, "ops"), box("d")];
      const edges = [edge("a", "d"), edge("b", "d"), edge("c", "d")];

      const { boxes } = computeLayeredLayout(nodes, edges);

      const xOf = (id: string) => boxOf(boxes, id).x;
      // Lane-less baseline order is a, b, c by id -- "ops" pulls "c" up next to "a", pushing "b" out.
      expect(Math.abs(xOf("a") - xOf("c"))).toBeCloseTo(130);
      expect(Math.abs(xOf("a") - xOf("b"))).toBeGreaterThan(130);
    });

    it("leaves a lane-less rank's ordering unchanged", () => {
      const nodes = [box("a"), box("b"), box("c")];

      const { boxes } = computeLayeredLayout(nodes, []);

      const xOf = (id: string) => boxOf(boxes, id).x;
      expect(xOf("a")).toBeLessThan(xOf("b"));
      expect(xOf("b")).toBeLessThan(xOf("c"));
    });
  });
});
