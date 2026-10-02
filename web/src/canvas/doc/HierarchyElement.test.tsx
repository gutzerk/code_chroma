import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HierarchyElement } from "./HierarchyElement";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { expansionStore } from "../../state/expansionState";
import { selectionStore } from "../../state/selectionStore";
import {
  IMPACT_CHANGES_STUB,
  EPIC_BRIEF_STUB,
  EPICS_STUB,
  PATTERNS_STUB,
  RESEARCH_STUB,
} from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasElement, HierarchyNodeRef } from "../../state/types";

function node(id: string, overrides: Partial<HierarchyNodeRef> = {}): HierarchyNodeRef {
  return {
    node_id: id,
    name: id,
    level: "folder",
    parent_id: null,
    has_children: false,
    child_count: 0,
    ...overrides,
  };
}

function element(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: "e1",
    render: "hierarchy",
    layer: "hierarchy",
    label: "",
    description: "",
    node_id: "root",
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "user",
    ...overrides,
  };
}

function client(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: (async () => ({}) as never) as EngineClient["getDiagram"],
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" }),
    getDiagramStatus: async () => ({ state: "idle", error: null }),
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    ...overrides,
  } as EngineClient;
}

afterEach(() => {
  expansionStore.reset();
  selectionStore.clear();
});

/** Untouched-by-construction: HierarchyElement wraps the real strategy renderer (TreeNode by
 * default), so these are the same behaviors Block/TreeNode always had — just proven to still work
 * once the row sits inside HierarchyElement's positioned/draggable wrapper. */
describe("HierarchyElement", () => {
  it("fetches the pinned node and renders it through the real tree strategy", async () => {
    const root = node("root", { name: "Root" });
    const engineClient = client({ getNode: async () => root });

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <HierarchyElement element={element()} />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("tree-node")).toHaveAttribute("data-node-id", "root"));
    expect(screen.getByText("Root")).toBeInTheDocument();
  });

  it("still expands lazily on click, fetching children from the engine client", async () => {
    const root = node("root", { name: "Root", has_children: true, child_count: 1 });
    const child = node("root/child", { name: "Child", parent_id: "root" });
    const engineClient = client({
      getNode: async () => root,
      getChildren: async (nodeId) => (nodeId === "root" ? [child] : []),
    });

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <HierarchyElement element={element()} />
      </EngineClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("tree-node-toggle")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tree-node-toggle"));

    await waitFor(() => expect(screen.getByText("Child")).toBeInTheDocument());
  });
});
