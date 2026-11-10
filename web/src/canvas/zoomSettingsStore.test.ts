import { afterEach, describe, expect, it } from "vitest";
import { autoDisplayScale, resolveDisplayScale, zoomSettingsStore } from "./zoomSettingsStore";

afterEach(() => {
  window.localStorage.clear();
  zoomSettingsStore.reloadForTests();
});

describe("display scale", () => {
  it.each([
    [1024, 1],
    [1600, 1],
    [2560, 1.6],
    [3840, 2],
  ])("auto scale for a %ipx window is %f", (width, expected) => {
    const scale = autoDisplayScale(width);

    expect(scale).toBe(expected);
  });

  it("uses a pinned scale over the window width", () => {
    const scale = resolveDisplayScale({ mouse: 1, trackpad: 1, displayScale: 1.5 }, 3840);

    expect(scale).toBe(1.5);
  });
});

describe("zoomSettingsStore", () => {
  it("persists a change and clamps an out-of-range sensitivity", () => {
    zoomSettingsStore.set({ mouse: 10, displayScale: 1.25 });
    zoomSettingsStore.reloadForTests();

    const settings = zoomSettingsStore.get();

    expect(settings).toEqual({ mouse: 3, trackpad: 1, displayScale: 1.25 });
  });

  it("falls back to defaults on corrupt storage", () => {
    window.localStorage.setItem("codechroma.zoomSettings", "{not json");

    const settings = zoomSettingsStore.get();

    expect(settings).toEqual({ mouse: 1, trackpad: 1, displayScale: "auto" });
  });
});
