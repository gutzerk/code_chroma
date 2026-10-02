import { afterEach, describe, expect, it } from "vitest";
import { hierarchyChangesStore } from "./hierarchyChangesStore";

afterEach(() => {
  hierarchyChangesStore.reset();
});

describe("hierarchyChangesStore", () => {
  it("knows nothing about any node by default", () => {
    expect(hierarchyChangesStore.getStatus("component::a.py")).toBeUndefined();
  });

  it("keys each status by its node id", () => {
    hierarchyChangesStore.setStatuses({ "component::a.py": "modified" });

    expect(hierarchyChangesStore.getStatus("component::a.py")).toBe("modified");
  });

  it("drops an unrecognized status word rather than surfacing it", () => {
    hierarchyChangesStore.setStatuses({ "component::a.py": "renamed" });

    expect(hierarchyChangesStore.getStatus("component::a.py")).toBeUndefined();
  });

  it("replaces the whole map on every publish, not just adding to it", () => {
    hierarchyChangesStore.setStatuses({ "component::a.py": "added" });

    hierarchyChangesStore.setStatuses({ "component::b.py": "removed" });

    expect(hierarchyChangesStore.getStatus("component::a.py")).toBeUndefined();
    expect(hierarchyChangesStore.getStatus("component::b.py")).toBe("removed");
  });

  it("drops every status on clear", () => {
    hierarchyChangesStore.setStatuses({ "component::a.py": "added" });

    hierarchyChangesStore.clear();

    expect(hierarchyChangesStore.getStatus("component::a.py")).toBeUndefined();
  });

  it("notifies subscribers once per published map", () => {
    let hits = 0;
    const unsubscribe = hierarchyChangesStore.subscribe(() => (hits += 1));

    hierarchyChangesStore.setStatuses({ "component::a.py": "added" });

    expect(hits).toBe(1);
    unsubscribe();
  });
});
