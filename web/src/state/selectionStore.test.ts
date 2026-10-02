import { afterEach, describe, expect, it, vi } from "vitest";
import { selectionStore } from "./selectionStore";

afterEach(() => selectionStore.clear());

describe("selectionStore", () => {
  it("starts with nothing selected", () => {
    expect(selectionStore.getSelectedIds()).toEqual([]);
    expect(selectionStore.size()).toBe(0);
    expect(selectionStore.isSelected("a")).toBe(false);
  });

  it("toggle adds an id not yet selected", () => {
    selectionStore.toggle("a");

    expect(selectionStore.isSelected("a")).toBe(true);
    expect(selectionStore.getSelectedIds()).toEqual(["a"]);
  });

  it("toggle removes an id already selected, leaving the rest", () => {
    selectionStore.toggle("a");
    selectionStore.toggle("b");

    selectionStore.toggle("a");

    expect(selectionStore.isSelected("a")).toBe(false);
    expect(selectionStore.isSelected("b")).toBe(true);
    expect(selectionStore.size()).toBe(1);
  });

  it("replace swaps in a whole new selection", () => {
    selectionStore.toggle("a");

    selectionStore.replace(["b", "c"]);

    expect(selectionStore.getSelectedIds()).toEqual(["b", "c"]);
    expect(selectionStore.isSelected("a")).toBe(false);
  });

  it("clear empties the selection", () => {
    selectionStore.toggle("a");

    selectionStore.clear();

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("notifies subscribers once per actual change", () => {
    const listener = vi.fn();
    selectionStore.subscribe(listener);

    selectionStore.toggle("a");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("replace with an identical set does not notify", () => {
    selectionStore.replace(["a", "b"]);
    const listener = vi.fn();
    selectionStore.subscribe(listener);

    selectionStore.replace(["b", "a"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("clear on an already-empty selection does not notify", () => {
    const listener = vi.fn();
    selectionStore.subscribe(listener);

    selectionStore.clear();

    expect(listener).not.toHaveBeenCalled();
  });

  it("getSelectedIds returns a stable reference across an unrelated notify", () => {
    selectionStore.toggle("a");
    const first = selectionStore.getSelectedIds();

    selectionStore.replace(["a"]);
    const second = selectionStore.getSelectedIds();

    expect(second).toBe(first);
  });
});
