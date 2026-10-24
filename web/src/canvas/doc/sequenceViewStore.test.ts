import { beforeEach, describe, expect, it, vi } from "vitest";
import { sequenceViewStore } from "./sequenceViewStore";

describe("sequenceViewStore", () => {
  beforeEach(() => sequenceViewStore.reset());

  it("defaults to readable up to 12 messages and focus above", () => {
    expect(sequenceViewStore.get("a", 12).mode).toBe("readable");
    expect(sequenceViewStore.get("a", 13).mode).toBe("focus");
  });

  it("keeps collapse and focus across a mode switch back and forth", () => {
    sequenceViewStore.setCollapsed("a", ["p1"]);
    sequenceViewStore.setFocus("a", "api");
    sequenceViewStore.setMode("a", "readable");
    sequenceViewStore.setMode("a", "focus");

    expect(sequenceViewStore.get("a", 3)).toEqual({ mode: "focus", collapsed: ["p1"], focus: "api" });
  });

  it("persists the choice in localStorage", () => {
    sequenceViewStore.setMode("a", "focus");

    const key = Object.keys(window.localStorage).find((k) => k.startsWith("codechroma.sequence-view"));

    expect(window.localStorage.getItem(key ?? "")).toContain("focus");
  });

  it("still works when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    sequenceViewStore.setMode("b", "focus");

    expect(sequenceViewStore.get("b", 1).mode).toBe("focus");
    spy.mockRestore();
  });
});
