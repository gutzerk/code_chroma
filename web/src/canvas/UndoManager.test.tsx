import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { undoStore } from "../state/undoStore";
import { UNDO_EVENT, UndoManager, type UndoEventDetail } from "./UndoManager";

function key(key: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  fireEvent.keyDown(document, { key, ...mods });
}

function captureUndoEvent(): UndoEventDetail[] {
  const events: UndoEventDetail[] = [];
  window.addEventListener(UNDO_EVENT, (e) => events.push((e as CustomEvent<UndoEventDetail>).detail));
  return events;
}

describe("UndoManager", () => {
  beforeEach(() => {
    undoStore.reset();
  });

  afterEach(() => {
    undoStore.reset();
    vi.restoreAllMocks();
  });

  it("is a no-op when none of the given kinds has anything to undo", () => {
    render(<UndoManager kinds={["c1"]} />);
    const events = captureUndoEvent();

    key("z", { ctrlKey: true });

    expect(events).toEqual([]);
  });

  it("pops the one given kind's entry and dispatches it tagged with that kind", () => {
    render(<UndoManager kinds={["hierarchy"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("hierarchy", { a: { x: 1, y: 2 } });

    const handled = fireEvent.keyDown(document, { key: "z", ctrlKey: true });

    expect(events).toEqual([{ kind: "hierarchy", layout: { a: { x: 1, y: 2 } } }]);
    // fireEvent returns false when preventDefault() was called — the browser undo is suppressed.
    expect(handled).toBe(false);
  });

  it("does not undo a kind that isn't in the given list", () => {
    render(<UndoManager kinds={["c1"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("patterns", { p: { x: 0, y: 0 } });

    key("z", { ctrlKey: true });

    expect(events).toEqual([]);
    // The patterns entry is untouched — still undoable.
    expect(undoStore.canUndo("patterns")).toBe(true);
  });

  it("handles Cmd+Z (metaKey) on macOS", () => {
    render(<UndoManager kinds={["c1"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("c1", { a: { x: 3, y: 4 } });

    key("z", { metaKey: true });

    expect(events).toEqual([{ kind: "c1", layout: { a: { x: 3, y: 4 } } }]);
  });

  it("ignores plain Z and Ctrl used without Z", () => {
    render(<UndoManager kinds={["c1"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("c1", { a: { x: 0, y: 0 } });

    key("z");
    key("z", { ctrlKey: true }); // handled — will pop
    key("a", { ctrlKey: true });

    // Only the Ctrl+Z fired an event; plain Z and Ctrl+A did not.
    expect(events).toHaveLength(1);
  });

  it("re-subscribes when the given kinds change", () => {
    const { rerender } = render(<UndoManager kinds={["c1"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("epics", { e: { x: 7, y: 7 } });

    // Under c1 only, nothing.
    key("z", { ctrlKey: true });
    expect(events).toEqual([]);

    // Switch to epics — the shortcut now targets epics.
    rerender(<UndoManager kinds={["epics"]} />);
    key("z", { ctrlKey: true });
    expect(events).toEqual([{ kind: "epics", layout: { e: { x: 7, y: 7 } } }]);
  });

  it("with multiple kinds given, undoes whichever was committed most recently", () => {
    render(<UndoManager kinds={["hierarchy", "canvas"]} />);
    const events = captureUndoEvent();
    undoStore.recordCommit("hierarchy", { a: { x: 1, y: 1 } });
    undoStore.recordCommit("canvas", { b: { x: 2, y: 2 } });

    key("z", { ctrlKey: true });

    // "canvas" was committed after "hierarchy", so it undoes first regardless of kind order.
    expect(events).toEqual([{ kind: "canvas", layout: { b: { x: 2, y: 2 } } }]);
    expect(undoStore.canUndo("hierarchy")).toBe(true);
    expect(undoStore.canUndo("canvas")).toBe(false);
  });
});
