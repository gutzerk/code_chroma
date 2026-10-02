import { describe, expect, it, beforeEach } from "vitest";
import { liveStore } from "./liveStore";

describe("liveStore", () => {
  beforeEach(() => liveStore.reset());

  it("advances the version and notifies subscribers on bump", () => {
    const seen: number[] = [];
    const unsubscribe = liveStore.subscribe(() => seen.push(liveStore.getVersion()));

    liveStore.bump();
    liveStore.bump();
    unsubscribe();
    liveStore.bump();

    expect(seen).toEqual([1, 2]);
    expect(liveStore.getVersion()).toBe(3);
  });
});
