import { afterEach, describe, expect, it } from "vitest";
import { SidecarStore } from "./sidecarStore";

interface Record_ {
  node_id: string;
  label: string;
}

const EMPTY = { records: [] as Record_[] };

function snapshot(records: Record_[]) {
  return { records };
}

const store = new SidecarStore<Record_, ReturnType<typeof snapshot>>(EMPTY);

afterEach(() => {
  store.reset();
});

describe("SidecarStore", () => {
  it("is inactive and knows nothing about any node by default", () => {
    expect(store.getForNode("a")).toBeUndefined();
    expect(store.getIsActive()).toBe(false);
    expect(store.getSnapshot()).toBe(EMPTY);
  });

  it("keys each record by its own node id and marks itself active", () => {
    const a = { node_id: "a", label: "A" };

    store.setSnapshot(snapshot([a]), [a]);

    expect(store.getForNode("a")).toEqual(a);
    expect(store.getIsActive()).toBe(true);
  });

  it("stays active even when a fresh snapshot legitimately has no records", () => {
    store.setSnapshot(snapshot([]), []);

    expect(store.getIsActive()).toBe(true);
  });

  it("drops every record and returns to the empty snapshot on clear", () => {
    const a = { node_id: "a", label: "A" };
    store.setSnapshot(snapshot([a]), [a]);

    store.clear();

    expect(store.getForNode("a")).toBeUndefined();
    expect(store.getIsActive()).toBe(false);
    expect(store.getSnapshot()).toBe(EMPTY);
  });

  it("notifies subscribers once per published snapshot", () => {
    let hits = 0;
    const unsubscribe = store.subscribe(() => (hits += 1));

    store.setSnapshot(snapshot([]), []);

    expect(hits).toBe(1);
    unsubscribe();
  });

  it("bumps the geometry version without notifying record subscribers", () => {
    let geometryHits = 0;
    let recordHits = 0;
    const unsubGeometry = store.geometry.subscribe(() => (geometryHits += 1));
    const unsubRecords = store.subscribe(() => (recordHits += 1));
    const before = store.geometry.getVersion();

    store.notifyGeometryChange();

    expect(store.geometry.getVersion()).toBe(before + 1);
    expect(geometryHits).toBe(1);
    expect(recordHits).toBe(0);
    unsubGeometry();
    unsubRecords();
  });
});
