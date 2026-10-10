import { describe, expect, it } from "vitest";
import { layoutBoxes, layoutDiagramEdges } from "./diagramLayout";
import type { Rect } from "./orthogonalRoute";

describe("layoutBoxes", () => {
  it("returns an empty result with sane fallback dimensions for no nodes", async () => {
    const result = await layoutBoxes([], []);

    expect(result).toEqual({ boxes: [], width: 600, height: 400 });
  });

  it("still type-checks and lays out a plain {from, to} edge with no kind", async () => {
    const nodes = [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
    ];
    const edges: { from: string; to: string }[] = [{ from: "a", to: "b" }];

    const { boxes } = await layoutBoxes(nodes, edges);

    expect(boxes.map((box) => box.id).sort()).toEqual(["a", "b"]);
  });

  it("returns every input node exactly once in boxes", async () => {
    const nodes = [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
      { id: "c", width: 100, height: 50 },
    ];
    const edges = [{ from: "a", to: "b", kind: "uses" }];

    const { boxes } = await layoutBoxes(nodes, edges);

    expect(boxes).toHaveLength(3);
    expect(boxes.map((box) => box.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("skips an edge naming an id not present in nodes, same as before the body swap", async () => {
    const nodes = [{ id: "a", width: 100, height: 50 }];
    const edges = [{ from: "a", to: "missing" }];

    const { boxes } = await layoutBoxes(nodes, edges);

    expect(boxes).toEqual([{ id: "a", x: expect.any(Number), y: expect.any(Number), width: 100, height: 50 }]);
  });
});

describe("layoutDiagramEdges", () => {
  it("carries an authored hero flag through, not just from/to/kind/label", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [
      { from: "a", to: "b", label: "charges through", hero: true },
    ];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.hero).toBe(true);
  });

  it("leaves hero undefined for a relation that never authored it", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [{ from: "a", to: "b", label: "calls" }];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.hero).toBeUndefined();
  });

  it("carries an authored transport through to the positioned edge", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [{ from: "a", to: "b", label: "Sends", transport: "https" }];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.transport).toBe("https");
  });

  it("leaves transport undefined for a relation that never authored it", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [{ from: "a", to: "b", label: "calls" }];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.transport).toBeUndefined();
  });

  it("carries an authored style through to the positioned edge", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [{ from: "a", to: "b", style: { color: "#ff5500" } }];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.style).toEqual({ color: "#ff5500" });
  });

  it("leaves style undefined for a relation that never authored it", () => {
    const rectByKey = new Map<string, Rect>([
      ["a", { left: 0, top: 0, width: 100, height: 50 }],
      ["b", { left: 200, top: 0, width: 100, height: 50 }],
    ]);
    const relations = [{ from: "a", to: "b", label: "calls" }];

    const [edge] = layoutDiagramEdges(relations, rectByKey);

    expect(edge.style).toBeUndefined();
  });
});
