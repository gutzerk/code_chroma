import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasLayoutStore } from "./canvasLayoutStore";

afterEach(() => {
  canvasLayoutStore.reset();
});

describe("canvasLayoutStore", () => {
  it("increments the version on each bump", () => {
    const start = canvasLayoutStore.getVersion();
    canvasLayoutStore.bump();
    canvasLayoutStore.bump();
    expect(canvasLayoutStore.getVersion()).toBe(start + 2);
  });

  it("notifies subscribers on bump and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = canvasLayoutStore.subscribe(listener);
    canvasLayoutStore.bump();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    canvasLayoutStore.bump();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resets the version to zero", () => {
    canvasLayoutStore.bump();
    canvasLayoutStore.reset();
    expect(canvasLayoutStore.getVersion()).toBe(0);
  });
});
