import { beforeEach, describe, expect, it, vi } from "vitest";

const visible = vi.hoisted(() => new Map<string, string | null>());

vi.mock("../state/expansionState", () => ({
  expansionStore: { getNearestVisibleAncestor: (id: string) => visible.get(id) ?? null },
}));

import { borderSegment, countLabel, getToLocal, resolveVisibleEdges } from "./canvasOverlay";

describe("countLabel", () => {
  it("uses the default empty text for zero", () => {
    expect(countLabel(0, "edge")).toBe("No edges");
  });

  it("uses a custom empty text for zero", () => {
    expect(countLabel(0, "edge", { emptyText: "Nothing" })).toBe("Nothing");
  });

  it("is singular for one and plural otherwise", () => {
    expect(countLabel(1, "edge")).toBe("1 edge");
    expect(countLabel(3, "edge")).toBe("3 edges");
  });

  it("adds the prefix and suffix around a non-empty count", () => {
    expect(countLabel(2, "step", { prefix: "Trace:", suffix: "recorded" })).toBe(
      "Trace: 2 steps recorded",
    );
  });
});

describe("borderSegment", () => {
  it("meets each box on the sides facing the other for horizontally separated boxes", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 30, top: 0, right: 40, bottom: 10 };

    expect(borderSegment(a, b)).toEqual({ from: { x: 10, y: 5 }, to: { x: 30, y: 5 } });
  });

  it("meets each box on the top and bottom for vertically separated boxes", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 0, top: 30, right: 10, bottom: 40 };

    expect(borderSegment(a, b)).toEqual({ from: { x: 5, y: 10 }, to: { x: 5, y: 30 } });
  });
});

describe("getToLocal", () => {
  it("is null without an svg", () => {
    expect(getToLocal(null)).toBeNull();
  });

  it("is null when the svg cannot report a screen CTM", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    expect(getToLocal(svg as SVGSVGElement)).toBeNull();
  });

  it("is null when the CTM is not available yet", () => {
    const svg = { getScreenCTM: () => null } as unknown as SVGSVGElement;

    expect(getToLocal(svg)).toBeNull();
  });
});

describe("resolveVisibleEdges", () => {
  beforeEach(() => visible.clear());

  const idsOf = (item: { a: string; b: string }) => [item.a, item.b] as const;

  it("maps endpoints to their nearest visible ancestors", () => {
    visible.set("deep-a", "box-a");
    visible.set("b", "b");

    const result = resolveVisibleEdges([{ a: "deep-a", b: "b" }], idsOf);

    expect(result.map((r) => [r.key, r.fromId, r.toId])).toEqual([["box-a->b", "box-a", "b"]]);
  });

  it("drops edges whose endpoints collapse into the same box", () => {
    visible.set("x1", "box");
    visible.set("x2", "box");

    expect(resolveVisibleEdges([{ a: "x1", b: "x2" }], idsOf)).toEqual([]);
  });

  it("drops edges with an unknown endpoint", () => {
    visible.set("a", "a");

    expect(resolveVisibleEdges([{ a: "a", b: "ghost" }], idsOf)).toEqual([]);
  });

  it("dedupes same-direction edges but keeps the reverse direction", () => {
    visible.set("a", "a");
    visible.set("b", "b");
    const items = [
      { a: "a", b: "b" },
      { a: "a", b: "b" },
      { a: "b", b: "a" },
    ];

    const result = resolveVisibleEdges(items, idsOf);

    expect(result.map((r) => r.key)).toEqual(["a->b", "b->a"]);
  });
});
