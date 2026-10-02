import { afterEach, describe, expect, it } from "vitest";
import { impactChangesSidecarStore, hasOwnChangeContent, setChangesSnapshot } from "./useSidecar";
import type { ImpactBlockChange, ImpactChanges, ImpactGhostBlock } from "./types";

function block(overrides: Partial<ImpactBlockChange> = {}): ImpactBlockChange {
  return {
    block: "engine",
    node_id: "engine",
    name: "Engine",
    path: "src",
    status: "modified",
    files: [],
    change_count: 1,
    before: "",
    after: "",
    explanation: "",
    pr_comments: [],
    ...overrides,
  };
}

function ghost(overrides: Partial<ImpactGhostBlock> = {}): ImpactGhostBlock {
  return {
    id: "clustering",
    node_id: "impact-ghost::engine/clustering",
    parent: "engine",
    parent_node_id: "engine",
    name: "Reference clustering",
    status: "removed",
    before: "Union-find over call edges.",
    after: "",
    explanation: "",
    ...overrides,
  };
}

function changes(overrides: Partial<ImpactChanges> = {}): ImpactChanges {
  return {
    fingerprint: "abc",
    reviewed_fingerprint: "abc",
    has_review: true,
    stale: false,
    summary: "Reworked the engine.",
    blocks: [],
    ghosts: [],
    relationships: [],
    unassigned: [],
    changed_file_count: 1,
    general_pr_comments: [],
    ...overrides,
  };
}

afterEach(() => {
  impactChangesSidecarStore.reset();
});

describe("setChangesSnapshot", () => {
  it("keys each block change by its canvas node id", () => {
    setChangesSnapshot(changes({ blocks: [block()] }));

    expect(impactChangesSidecarStore.getForNode("engine")).toEqual(block());
  });

  it("resolves a ghost's own node id as a removed change, so it renders as one", () => {
    setChangesSnapshot(changes({ ghosts: [ghost()] }));

    const asChange = impactChangesSidecarStore.getForNode(ghost().node_id);
    expect(asChange?.status).toBe("removed");
    expect(asChange?.before).toBe("Union-find over call edges.");
  });

  it("publishes the whole payload as the snapshot, for the summary card", () => {
    const payload = changes({ summary: "hello" });

    setChangesSnapshot(payload);

    expect(impactChangesSidecarStore.getSnapshot()).toBe(payload);
  });
});

describe("hasOwnChangeContent", () => {
  it("is false for a pure rollup with only a descendant count", () => {
    expect(hasOwnChangeContent(block({ change_count: 3 }))).toBe(false);
  });

  it("is true for a removed block even with empty prose", () => {
    expect(hasOwnChangeContent(block({ status: "removed" }))).toBe(true);
  });

  it("is true when there is before/after/explanation prose", () => {
    expect(hasOwnChangeContent(block({ before: "old" }))).toBe(true);
  });
});
