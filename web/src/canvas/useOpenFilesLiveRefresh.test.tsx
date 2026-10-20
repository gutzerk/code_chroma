import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOpenFilesLiveRefresh } from "./useOpenFilesLiveRefresh";
import { openFilesStore } from "./openFilesStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../state/types";

function node(id: string, source: string): HierarchyNodeRef {
  return { node_id: id, name: id, level: "function", parent_id: null, has_children: false, child_count: 0, source };
}

afterEach(() => openFilesStore.reset());

describe("useOpenFilesLiveRefresh", () => {
  it("re-reads open files after a live ping and keeps a file whose node no longer resolves", async () => {
    openFilesStore.open(node("a", "old"));
    openFilesStore.open(node("gone", "last known"));
    const client = {
      getNode: async (id: string) => (id === "a" ? node("a", "fresh") : null),
    } as unknown as EngineClient;

    renderHook(() => useOpenFilesLiveRefresh(client, 1));

    await waitFor(() => expect(openFilesStore.getFiles().find((f) => f.node_id === "a")?.source).toBe("fresh"));
    expect(openFilesStore.getFiles().find((f) => f.node_id === "gone")?.source).toBe("last known");
  });

  it("does nothing before the first ping", () => {
    openFilesStore.open(node("a", "old"));
    const client = { getNode: async () => node("a", "fresh") } as unknown as EngineClient;

    renderHook(() => useOpenFilesLiveRefresh(client, 0));

    expect(openFilesStore.getFiles()[0].source).toBe("old");
  });
});
