import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNodeChrome } from "./useNodeChrome";
import { impactChangesSidecarStore, setChangesSnapshot } from "../../state/useSidecar";
import { hierarchyChangesStore } from "../../state/hierarchyChangesStore";
import type { ImpactBlockChange, HierarchyNodeRef } from "../../state/types";

const NODE: HierarchyNodeRef = {
  node_id: "function::foo",
  name: "foo",
  level: "function",
  parent_id: null,
  has_children: false,
  child_count: 0,
};

function impactChangeFixture(overrides: Partial<ImpactBlockChange> = {}): ImpactBlockChange {
  return {
    block: "system/engine",
    node_id: NODE.node_id,
    name: "foo",
    path: "a.py",
    status: "removed",
    files: [],
    change_count: 1,
    before: "",
    after: "",
    explanation: "",
    pr_comments: [],
    ...overrides,
  };
}

afterEach(() => {
  impactChangesSidecarStore.reset();
  hierarchyChangesStore.reset();
});

describe("useNodeChrome's changeClass", () => {
  it("is empty when neither store has anything for this node", () => {
    const { result } = renderHook(() => useNodeChrome(NODE));

    expect(result.current.changeClass).toBe("");
  });

  it("reflects the plain hierarchy view's own status when the Impact store is empty", () => {
    hierarchyChangesStore.setStatuses({ [NODE.node_id]: "modified" });

    const { result } = renderHook(() => useNodeChrome(NODE));

    expect(result.current.changeClass).toBe(" block-change--modified");
  });

  it("prefers the Impact review's status over the plain hierarchy view's own", () => {
    hierarchyChangesStore.setStatuses({ [NODE.node_id]: "modified" });
    setChangesSnapshot({
      fingerprint: "",
      reviewed_fingerprint: null,
      has_review: false,
      stale: false,
      summary: "",
      blocks: [impactChangeFixture()],
      ghosts: [],
      relationships: [],
      unassigned: [],
      changed_file_count: 1,
      general_pr_comments: [],
    });

    const { result } = renderHook(() => useNodeChrome(NODE));

    expect(result.current.changeClass).toBe(" block-change--removed");
  });
});
