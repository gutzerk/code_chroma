import { beforeEach, describe, expect, it } from "vitest";
import { UNDO_LIMIT, UndoStore } from "./undoStore";
import type { Offset } from "../canvas/useDragOffset";

describe("UndoStore", () => {
  let store: UndoStore;

  beforeEach(() => {
    store = new UndoStore();
  });

  it("undo returns null when the kind has nothing recorded", () => {
    expect(store.canUndo("c1")).toBe(false);
    expect(store.undo("c1")).toBeNull();
  });

  it("undo restores the pre-commit layout (the state to go back to), LIFO per kind", () => {
    const baseline: Record<string, Offset> = { a: { x: 0, y: 0 } };
    const afterFirst: Record<string, Offset> = { a: { x: 1, y: 1 } };

    store.recordCommit("c1", baseline);
    store.recordCommit("c1", afterFirst);

    expect(store.canUndo("c1")).toBe(true);
    // Undoing the second drag restores the state that existed before it.
    expect(store.undo("c1")).toEqual(afterFirst);
    // Undoing the first drag restores the baseline.
    expect(store.undo("c1")).toEqual(baseline);
    expect(store.canUndo("c1")).toBe(false);
    expect(store.undo("c1")).toBeNull();
  });

  it("keeps kinds independent", () => {
    store.recordCommit("patterns", { p: { x: 5, y: 5 } });

    expect(store.canUndo("patterns")).toBe(true);
    expect(store.canUndo("c1")).toBe(false);
    expect(store.undo("c1")).toBeNull();
    expect(store.undo("patterns")).toEqual({ p: { x: 5, y: 5 } });
  });

  it("caps history per kind at UNDO_LIMIT entries", () => {
    for (let i = 0; i < 15; i += 1) {
      store.recordCommit("epics", { n: { x: i, y: i } });
    }

    const undone: Record<string, Offset>[] = [];
    while (store.canUndo("epics")) {
      const snapshot = store.undo("epics");
      if (snapshot) undone.push(snapshot);
    }

    expect(undone.length).toBe(UNDO_LIMIT);
    // LIFO: the newest entry undoes first. The oldest 5 fell off; the newest 10 survive.
    expect(undone[0]).toEqual({ n: { x: 14, y: 14 } });
    expect(undone[9]).toEqual({ n: { x: 5, y: 5 } });
  });

  it("reset clears every kind's history", () => {
    store.recordCommit("c1", { a: { x: 0, y: 0 } });
    store.recordCommit("hierarchy", { h: { x: 0, y: 0 } });
    store.reset();

    expect(store.canUndo("c1")).toBe(false);
    expect(store.canUndo("hierarchy")).toBe(false);
  });

  it("notifies subscribers on record and on undo", () => {
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.recordCommit("c1", { a: { x: 0, y: 0 } });
    store.undo("c1");

    expect(calls).toBe(2);
  });

  it("undoLatest pops whichever given kind was committed most recently", () => {
    store.recordCommit("hierarchy", { a: { x: 1, y: 1 } });
    store.recordCommit("canvas", { b: { x: 2, y: 2 } });

    // "canvas" is the more recent commit even though "hierarchy" is listed first.
    expect(store.undoLatest(["hierarchy", "canvas"])).toEqual({
      kind: "canvas",
      layout: { b: { x: 2, y: 2 } },
    });
    expect(store.canUndo("hierarchy")).toBe(true);
    expect(store.canUndo("canvas")).toBe(false);
  });

  it("undoLatest returns null when none of the given kinds has anything to undo", () => {
    store.recordCommit("patterns", { p: { x: 0, y: 0 } });

    expect(store.undoLatest(["hierarchy", "canvas"])).toBeNull();
  });
});
