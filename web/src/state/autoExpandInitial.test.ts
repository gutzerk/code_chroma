import { afterEach, describe, expect, it, vi } from "vitest";
import { autoExpandInitial } from "./autoExpandInitial";
import { expansionStore } from "./expansionState";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "./types";
import { EPICS_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB } from "../engine-client/stubEngineClient";

afterEach(() => {
  expansionStore.reset();
});

function folder(id: string, parent: string | null, childCount: number): HierarchyNodeRef {
  return {
    node_id: id,
    name: id,
    level: "folder",
    parent_id: parent,
    has_children: childCount > 0,
    child_count: childCount,
  };
}

function file(id: string, parent: string): HierarchyNodeRef {
  return { node_id: id, name: id, level: "file", parent_id: parent, has_children: false, child_count: 0 };
}

function clientFor(childrenById: Record<string, HierarchyNodeRef[]>): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: vi.fn(),
    getChildren: vi.fn(async (nodeId: string) => childrenById[nodeId] ?? []),
    getConnections: vi.fn(),
    getDiff: vi.fn(),
    acceptDiff: vi.fn(),
    getDiagram: vi.fn(),
    getDiagramLayout: vi.fn(),
    saveDiagramLayout: vi.fn(),
    generateDiagram: vi.fn(),
    getDiagramStatus: vi.fn(),
    listTraces: vi.fn(async () => []),
    getTrace: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    subscribeDiagram: vi.fn(() => () => {}),
    subscribeDiagramStatus: vi.fn(() => () => {}),
    subscribeTrace: vi.fn(() => () => {}),
    subscribeTraceStream: vi.fn(() => () => {}),
  };
}

describe("autoExpandInitial", () => {
  it("expands only the root when it already has >= 5 direct children", async () => {
    const root = folder("root", null, 8);
    const client = clientFor({
      root: Array.from({ length: 8 }, (_, i) => file(`f${i}`, "root")),
    });

    await autoExpandInitial(root, client);

    expect(expansionStore.isVisible("root")).toBe(true);
    expect(client.getChildren).toHaveBeenCalledTimes(1);
  });

  it("cascades into the next level when the first level has fewer than 5 nodes", async () => {
    const root = folder("root", null, 3);
    const client = clientFor({
      root: [folder("a", "root", 5), folder("b", "root", 5), folder("c", "root", 5)],
      a: Array.from({ length: 5 }, (_, i) => file(`a${i}`, "a")),
      b: Array.from({ length: 5 }, (_, i) => file(`b${i}`, "b")),
      c: Array.from({ length: 5 }, (_, i) => file(`c${i}`, "c")),
    });

    const revealed = await autoExpandInitial(root, client);

    expect(expansionStore.isVisible("root")).toBe(true);
    expect(expansionStore.isVisible("a")).toBe(true);
    expect(expansionStore.isVisible("b")).toBe(true);
    expect(expansionStore.isVisible("c")).toBe(true);
    // Returns the whole revealed set (root + folders + their files) for the caller to frame.
    expect(revealed).toContain("root");
    expect(revealed).toContain("a");
    expect(revealed).toContain("a0");
    expect(revealed).toHaveLength(1 + 3 + 15);
  });

  it("descends through single-child wrapper folders until it reaches >= 5 nodes", async () => {
    const root = folder("root", null, 1);
    const client = clientFor({
      root: [folder("wrapper", "root", 6)],
      wrapper: Array.from({ length: 6 }, (_, i) => file(`w${i}`, "wrapper")),
    });

    await autoExpandInitial(root, client);

    expect(expansionStore.isVisible("root")).toBe(true);
    expect(expansionStore.isVisible("wrapper")).toBe(true);
  });

  it("stops without revealing a level whose fan-out exceeds the cap", async () => {
    const root = folder("root", null, 60);
    const client = clientFor({
      root: Array.from({ length: 60 }, (_, i) => file(`f${i}`, "root")),
    });

    const revealed = await autoExpandInitial(root, client);

    expect(expansionStore.isVisible("root")).toBe(false);
    // Nothing was revealed beyond root, so the caller just frames root itself.
    expect(revealed).toEqual(["root"]);
  });

  it("never expands files, only folders", async () => {
    const root = folder("root", null, 2);
    const client = clientFor({
      root: [file("doc.py", "root"), file("main.py", "root")],
    });

    await autoExpandInitial(root, client);

    expect(expansionStore.isVisible("root")).toBe(true);
    expect(expansionStore.isVisible("doc.py")).toBe(false);
    expect(expansionStore.isVisible("main.py")).toBe(false);
  });
});
