import { describe, expect, it } from "vitest";
import { edgeVisual } from "./edgeKinds";
import { neighbourLinks } from "./focusNeighbors";
import { bundleEdges, bundledKeys } from "./bundleEdges";
import { groupRoleIndex } from "./groupColor";
import { EMPTY_CANVAS_DOC, type CanvasEdge } from "../../state/types";

const edge = (id: string, from: string, to: string, kind = "uses", label = ""): CanvasEdge => ({ id, from, to, label, kind, layer: "l" });

describe("edgeVisual", () => {
  it.each([
    ["spawns", "spawn"], ["process", "spawn"], ["writes", "data"], ["READ", "data"],
    ["secondary", "minor"], ["uses", "call"], ["", "call"],
  ])("maps %s to %s", (kind, expected) => {
    expect(edgeVisual(kind)).toBe(expected);
  });

  it("falls back to the transport token", () => {
    expect(edgeVisual("uses", "spawn")).toBe("spawn");
  });
});

describe("neighbourLinks", () => {
  it("keeps the edge label and the visual family per neighbour", () => {
    const doc = { ...EMPTY_CANVAS_DOC, edges: { e1: edge("e1", "a", "b", "uses", "BuildClusters"), e2: edge("e2", "b", "c", "spawns"), e3: edge("e3", "x", "b") } };

    const links = neighbourLinks(doc, "b");

    expect(links.calledBy.map((l) => l.id)).toEqual(["a", "x"]);
    expect(links.calledBy[0].label).toBe("BuildClusters");
    expect(links.uses).toEqual([{ id: "c", label: "spawns", visual: "spawn" }]);
  });
});

describe("bundledKeys", () => {
  it("flags only the collapsed edges", () => {
    const edges = [edge("1", "a", "b"), edge("2", "a", "b"), edge("3", "a", "c")];

    const keys = bundledKeys(edges, bundleEdges(edges));

    expect(keys.size).toBe(1);
  });
});

describe("groupRoleIndex", () => {
  it.each([["web/ · canvas", 5], ["skills/", 4], ["dotnet/CodeChroma.Bridge", 1], ["Storage", undefined]])("tints %s", (name, expected) => {
    expect(groupRoleIndex(name)).toBe(expected);
  });
});
