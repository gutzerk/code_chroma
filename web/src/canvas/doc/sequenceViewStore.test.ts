import { beforeEach, describe, expect, it, vi } from "vitest";
import { sequenceViewStore } from "./sequenceViewStore";

const storedValues = (): string[] =>
  Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
    .filter((k): k is string => !!k && k.startsWith("codechroma.sequence-view"))
    .map((k) => window.localStorage.getItem(k) ?? "");

describe("sequenceViewStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sequenceViewStore.reset();
  });

  it("starts with every step folded to its glance box", () => {
    expect(sequenceViewStore.get("a")).toEqual({ expanded: [] });
  });

  it("toggles a step open and shut in place", () => {
    sequenceViewStore.toggleExpanded("a", "m1");
    sequenceViewStore.toggleExpanded("a", "m2");
    sequenceViewStore.toggleExpanded("a", "m1");

    expect(sequenceViewStore.get("a").expanded).toEqual(["m2"]);
  });

  it("bumps the layout version on expand but not on a player step", () => {
    const before = sequenceViewStore.getLayoutVersion();
    sequenceViewStore.setStep("a", 2);
    const afterStep = sequenceViewStore.getLayoutVersion();
    sequenceViewStore.toggleExpanded("a", "m1");

    expect(afterStep).toBe(before);
    expect(sequenceViewStore.getLayoutVersion()).toBe(before + 1);
  });

  it("persists the choice in localStorage", () => {
    sequenceViewStore.toggleExpanded("a", "m7");

    expect(storedValues().join("")).toContain("m7");
  });

  it("still works when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    sequenceViewStore.toggleExpanded("b", "m1");

    expect(sequenceViewStore.get("b").expanded).toEqual(["m1"]);
    spy.mockRestore();
  });
});
