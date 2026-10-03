import { afterEach, describe, expect, it } from "vitest";
import { expansionStore } from "./expansionState";
import { clearExpansionSnapshot, writeExpansionSnapshot } from "./expansionPersistence";

afterEach(() => {
  expansionStore.reset();
  clearExpansionSnapshot();
});

describe("ExpansionStore", () => {
  it("expands and collapses a block independently of others", () => {
    expansionStore.expand("a");
    expansionStore.expand("b");
    expect(expansionStore.getBlockView("a").expand_state).toBe("expanded");
    expect(expansionStore.getBlockView("b").expand_state).toBe("expanded");

    expansionStore.collapse("a");
    expect(expansionStore.getBlockView("a").expand_state).toBe("collapsed");
    expect(expansionStore.getBlockView("b").expand_state).toBe("expanded");
  });

  it("toggles a block between expanded and collapsed", () => {
    expansionStore.toggleExpand("a");
    expect(expansionStore.getBlockView("a").expand_state).toBe("expanded");

    expansionStore.toggleExpand("a");
    expect(expansionStore.getBlockView("a").expand_state).toBe("collapsed");
  });

  it("cascades collapse to any tracked descendant once its ancestor collapses", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "parent", name: "parent", level: "folder", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "child", name: "child", level: "file", parent_id: "parent", has_children: false, child_count: 0 },
    ]);
    expansionStore.expand("parent");
    expansionStore.expand("child");

    expansionStore.collapse("parent");

    expect(expansionStore.getBlockView("child").expand_state).toBe("collapsed");
    expect(expansionStore.getExpandedNodeIdsByOrder()).not.toContain("child");
  });

  it("derives the deepest expanded path root-first from cached parent links", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "root", name: "root", level: "folder", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "child", name: "child", level: "file", parent_id: "root", has_children: false, child_count: 0 },
    ]);
    expansionStore.expand("root");
    expansionStore.expand("child");

    expect(expansionStore.getDeepestExpandedPath()).toEqual(["root", "child"]);
  });

  it("recomputes the deepest expanded path after a live reparent of an expanded node", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "old-parent", name: "old-parent", level: "folder", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "new-parent", name: "new-parent", level: "folder", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "child", name: "child", level: "file", parent_id: "old-parent", has_children: false, child_count: 0 },
    ]);
    expansionStore.expand("old-parent");
    expansionStore.expand("new-parent");
    expansionStore.expand("child");
    expect(expansionStore.getDeepestExpandedPath()).toEqual(["old-parent", "child"]);

    // A live reanalyze reparents "child" under "new-parent" — cacheNodeRefs is called again with
    // the same node id but a different parent_id, as useNodeChildren would on a re-fetch.
    expansionStore.cacheNodeRefs([
      { node_id: "child", name: "child", level: "file", parent_id: "new-parent", has_children: false, child_count: 0 },
    ]);

    expect(expansionStore.getDeepestExpandedPath()).toEqual(["new-parent", "child"]);
  });

  it("falls back to the raw node id when no name has been cached", () => {
    expect(expansionStore.getName("unseen")).toBe("unseen");
  });

  it("toggles a node's code visibility independently of its expand state", () => {
    expansionStore.expand("a");
    expansionStore.toggleCode("a");
    expect(expansionStore.getBlockView("a").code_visible).toBe(true);
    expect(expansionStore.getBlockView("a").expand_state).toBe("expanded");

    expansionStore.toggleCode("a");
    expect(expansionStore.getBlockView("a").code_visible).toBe(false);
  });

  it("resets code visibility when a block collapses, so it doesn't resurrect on re-expand", () => {
    expansionStore.expand("a");
    expansionStore.showCode("a");
    expect(expansionStore.getBlockView("a").code_visible).toBe(true);

    expansionStore.collapse("a");
    expect(expansionStore.getBlockView("a").code_visible).toBe(false);

    expansionStore.expand("a");
    expect(expansionStore.getBlockView("a").code_visible).toBe(false);
  });

  it("cascades code-visibility reset to descendants when an ancestor collapses", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "parent", name: "parent", level: "folder", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "child", name: "child", level: "file", parent_id: "parent", has_children: false, child_count: 0 },
    ]);
    expansionStore.expand("parent");
    expansionStore.expand("child");
    expansionStore.showCode("child");

    expansionStore.collapse("parent");

    expect(expansionStore.getBlockView("child").code_visible).toBe(false);
  });

  it("keeps the expanded-ids snapshot reference stable across a showCode call that doesn't touch it", () => {
    expansionStore.expand("a");
    const before = expansionStore.getExpandedNodeIdsByOrder();

    expansionStore.showCode("a");

    expect(expansionStore.getExpandedNodeIdsByOrder()).toBe(before);
  });

  it("keeps the code-visible snapshot reference stable across an expand call that doesn't touch it", () => {
    expansionStore.expand("a");
    expansionStore.showCode("a");
    const before = expansionStore.getCodeVisibleNodeIdsByOrder();

    expansionStore.expand("b");

    expect(expansionStore.getCodeVisibleNodeIdsByOrder()).toBe(before);
  });

  it("gives a new expanded-ids snapshot reference only when the expanded set actually changes", () => {
    const before = expansionStore.getExpandedNodeIdsByOrder();

    expansionStore.expand("a");

    expect(expansionStore.getExpandedNodeIdsByOrder()).not.toBe(before);
    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual(["a"]);
  });

  it("returns the root-first cached ancestor path for a chain that reaches a null parent", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "f", name: "f.py", level: "file", parent_id: null, has_children: true, child_count: 1 },
      { node_id: "fn", name: "fn", level: "function", parent_id: "f", has_children: false, child_count: 0 },
    ]);

    expect(expansionStore.getCachedAncestorPath("fn")).toEqual(["f", "fn"]);
  });

  it("returns the cached ancestor path when the chain ends at the bridge's synthetic root id", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "f", name: "f.py", level: "file", parent_id: "root", has_children: false, child_count: 0 },
    ]);

    expect(expansionStore.getCachedAncestorPath("f")).toEqual(["root", "f"]);
  });

  it("returns null for a chain broken partway up, so the caller refetches instead of guessing", () => {
    expansionStore.cacheNodeRefs([
      { node_id: "fn", name: "fn", level: "function", parent_id: "f", has_children: false, child_count: 0 },
    ]);

    expect(expansionStore.getCachedAncestorPath("fn")).toBeNull();
  });

  it("returns null for a node it has never cached at all", () => {
    expect(expansionStore.getCachedAncestorPath("unknown")).toBeNull();
  });

  it("reports hasRestoredExpansion only when a snapshot was seeded from storage", () => {
    expect(expansionStore.hasRestoredExpansion()).toBe(false);

    writeExpansionSnapshot({ expanded: ["a"], codeVisible: [] });
    expansionStore.load();

    expect(expansionStore.hasRestoredExpansion()).toBe(true);
    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual(["a"]);
  });

  it("load() ingests an empty snapshot as not-restored, so a blank workspace still auto-expands", () => {
    expansionStore.load();

    expect(expansionStore.hasRestoredExpansion()).toBe(false);
    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual([]);
  });

  it("reset() returns the store to the not-restored baseline without clearing the snapshot itself", () => {
    writeExpansionSnapshot({ expanded: ["a"], codeVisible: [] });
    expansionStore.load();
    expect(expansionStore.hasRestoredExpansion()).toBe(true);

    expansionStore.reset();

    expect(expansionStore.hasRestoredExpansion()).toBe(false);
    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual([]);
    // The snapshot survives reset -- a later load() picks it back up, as a workspace switch does.
    expansionStore.load();
    expect(expansionStore.hasRestoredExpansion()).toBe(true);
  });
});
