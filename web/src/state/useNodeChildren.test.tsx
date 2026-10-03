import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useNodeChildren } from "./useNodeChildren";
import { expansionStore } from "./expansionState";
import { liveStore } from "./liveStore";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "./types";
import { EPICS_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB, diagramStub } from "../engine-client/stubEngineClient";

function child(id: string, level: HierarchyNodeRef["level"] = "function"): HierarchyNodeRef {
  return {
    node_id: id,
    name: id,
    level,
    parent_id: "parent",
    has_children: false,
    child_count: 0,
  };
}

function clientYielding(sequence: HierarchyNodeRef[][]): EngineClient {
  let call = 0;
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async () => null,
    getChildren: async () => sequence[Math.min(call++, sequence.length - 1)],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: diagramStub({ c1: ({ nodes: [], relations: [] }) }),
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" }),
    getDiagramStatus: async () => ({ state: "idle" }),
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
  };
}

function wrapperFor(client: EngineClient) {
  return ({ children }: { children: ReactNode }) => (
    <EngineClientProvider repoId="default" client={client}>
      {children}
    </EngineClientProvider>
  );
}

afterEach(() => {
  expansionStore.reset();
  liveStore.reset();
});

describe("useNodeChildren live reconciliation", () => {
  it("re-fetches on a live bump and adds a new child collapsed", async () => {
    const client = clientYielding([[child("a")], [child("a"), child("b")]]);
    const { result } = renderHook(() => useNodeChildren("parent", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => liveStore.bump());

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current?.map((c) => c.node_id)).toContain("b");
    expect(expansionStore.getBlockView("b").expand_state).toBe("collapsed");
  });

  it("groups folders first, then files, then symbols, stable within each bucket", async () => {
    const client = clientYielding([
      [
        child("dir-b", "folder"),
        child("main.py", "file"),
        child("fn", "function"),
        child("dir-a", "folder"),
        child("app.css", "file"),
      ],
    ]);
    const { result } = renderHook(() => useNodeChildren("parent", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current).toHaveLength(5));

    expect(result.current?.map((c) => c.node_id)).toEqual([
      "dir-b",
      "dir-a",
      "main.py",
      "app.css",
      "fn",
    ]);
  });

  it("collapses a child that disappeared from the parent", async () => {
    const client = clientYielding([[child("a"), child("b")], [child("a")]]);
    const { result } = renderHook(() => useNodeChildren("parent", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    act(() => expansionStore.expand("b"));
    expect(expansionStore.isVisible("b")).toBe(true);

    act(() => liveStore.bump());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(expansionStore.isVisible("b")).toBe(false);
  });
});
