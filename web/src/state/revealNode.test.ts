import { afterEach, describe, expect, it, vi } from "vitest";
import { revealC1Node, revealNode } from "./revealNode";
import { expansionStore } from "./expansionState";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "./types";
import { EPICS_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB } from "../engine-client/stubEngineClient";

afterEach(() => {
  expansionStore.reset();
});

const ROOT: HierarchyNodeRef = {
  node_id: "root",
  name: "examples",
  level: "folder",
  parent_id: null,
  has_children: true,
  child_count: 1,
};
const FILE: HierarchyNodeRef = {
  node_id: "file::a.py",
  name: "a.py",
  level: "file",
  parent_id: "root",
  has_children: true,
  child_count: 1,
};
const FUNCTION: HierarchyNodeRef = {
  node_id: "function::foo",
  name: "foo",
  level: "function",
  parent_id: "file::a.py",
  has_children: false,
  child_count: 0,
};

function clientFor(nodesById: Record<string, HierarchyNodeRef>): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: vi.fn(async (nodeId: string) => nodesById[nodeId] ?? null),
    getChildren: vi.fn(),
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

describe("revealNode", () => {
  it("expands every container ancestor but leaves the target node collapsed", async () => {
    const client = clientFor({ root: ROOT, "file::a.py": FILE, "function::foo": FUNCTION });

    await revealNode("function::foo", client);

    expect(expansionStore.isVisible("root")).toBe(true);
    expect(expansionStore.isVisible("file::a.py")).toBe(true);
    expect(expansionStore.isVisible("function::foo")).toBe(false);
  });

  it("caches the walked ancestor refs so the breadcrumb can resolve names without refetching", async () => {
    const client = clientFor({ root: ROOT, "file::a.py": FILE, "function::foo": FUNCTION });

    await revealNode("function::foo", client);

    expect(expansionStore.getName("file::a.py")).toBe("a.py");
  });

  it("stops walking once it reaches a node with a null parent_id", async () => {
    const client = clientFor({ root: ROOT, "file::a.py": FILE, "function::foo": FUNCTION });

    await revealNode("function::foo", client);

    expect(client.getNode).toHaveBeenCalledTimes(3);
  });
});

describe("revealC1Node", () => {
  it("expands every ancestor of a nested sub-block under the system box", () => {
    revealC1Node("c1-sub::system/domain/orders/checkout");

    expect(expansionStore.isVisible("c1-sub::system/domain/orders")).toBe(true);
    expect(expansionStore.isVisible("c1-sub::system/domain")).toBe(true);
    expect(expansionStore.isVisible("c1-system")).toBe(true);
  });

  it("leaves the target block itself collapsed", () => {
    revealC1Node("c1-sub::system/domain/orders/checkout");

    expect(expansionStore.isVisible("c1-sub::system/domain/orders/checkout")).toBe(false);
  });

  it("expands up to the owning actor box for a sub-block nested under an actor", () => {
    revealC1Node("c1-sub::stripe/webhooks/handler");

    expect(expansionStore.isVisible("c1-sub::stripe/webhooks")).toBe(true);
    expect(expansionStore.isVisible("c1-actor::stripe")).toBe(true);
  });

  it("is a no-op for the two top-level anchors, which are already always mounted", () => {
    revealC1Node("c1-system");
    revealC1Node("c1-actor::stripe");

    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual([]);
  });
});
