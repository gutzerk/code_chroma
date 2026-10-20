import { afterEach, describe, expect, it } from "vitest";
import { openFilesStore } from "./openFilesStore";
import type { HierarchyNodeRef } from "../state/types";

function node(id: string, source: string): HierarchyNodeRef {
  return { node_id: id, name: id, level: "function", parent_id: null, has_children: false, child_count: 0, source };
}

afterEach(() => openFilesStore.reset());

describe("openFilesStore.replace", () => {
  it("swaps a fresh copy in place, keeping tab order and the active file", () => {
    openFilesStore.open(node("a", "old a"));
    openFilesStore.open(node("b", "old b"));

    openFilesStore.replace(node("a", "new a"));

    expect(openFilesStore.getFiles().map((f) => [f.node_id, f.source])).toEqual([
      ["b", "old b"],
      ["a", "new a"],
    ]);
    expect(openFilesStore.getActiveId()).toBe("b");
  });

  it("ignores a file that is not open", () => {
    openFilesStore.replace(node("zzz", "x"));

    expect(openFilesStore.getFiles()).toHaveLength(0);
  });
});
