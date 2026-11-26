import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERMINAL_FONT_DEFAULT,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  browserDisplayKey,
  resetDisplayWatchForTests,
  terminalFontStore,
  watchDisplayChanges,
} from "./terminalFontStore";
import { DESKTOP_READY_EVENT, type AgentCommand, type DesktopWorkspaceApi } from "../agents/desktopWorkspaceApi";

const KEY = "codechroma.terminalFont";

function onDisplay(width: number, height: number, ratio: number): void {
  vi.spyOn(window.screen, "width", "get").mockReturnValue(width);
  vi.spyOn(window.screen, "height", "get").mockReturnValue(height);
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(ratio);
  terminalFontStore.displayChanged();
}

describe("terminalFontStore", () => {
  beforeEach(() => {
    window.localStorage.removeItem(KEY);
    terminalFontStore.reloadForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(KEY);
    terminalFontStore.reloadForTests();
  });

  it("starts at the default size", () => {
    const size = terminalFontStore.get();

    expect(size).toBe(TERMINAL_FONT_DEFAULT);
  });

  it("keeps a size per display and an unseen display starts at the last one chosen", () => {
    onDisplay(1440, 900, 2);
    terminalFontStore.set(11);
    onDisplay(3840, 2160, 1);
    terminalFontStore.set(16);
    onDisplay(2560, 1440, 1);
    const unseen = terminalFontStore.get();
    onDisplay(1440, 900, 2);

    const laptop = terminalFontStore.get();

    expect([unseen, laptop]).toEqual([16, 11]);
  });

  it("clamps to the supported range", () => {
    terminalFontStore.set(100);
    const high = terminalFontStore.get();
    terminalFontStore.set(1);

    const low = terminalFontStore.get();

    expect([high, low]).toEqual([TERMINAL_FONT_MAX, TERMINAL_FONT_MIN]);
  });

  it("survives a reload", () => {
    terminalFontStore.set(14);
    terminalFontStore.reloadForTests();

    const size = terminalFontStore.get();

    expect(size).toBe(14);
  });

  it("falls back to the default when storage cannot be read or written", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const before = terminalFontStore.get();

    terminalFontStore.set(15);

    expect([before, terminalFontStore.get()]).toEqual([TERMINAL_FONT_DEFAULT, 15]);
  });

  it("ignores stored garbage", () => {
    window.localStorage.setItem(KEY, "{not json");

    const size = terminalFontStore.get();

    expect(size).toBe(TERMINAL_FONT_DEFAULT);
  });

  it("prefers the shell's display identity over the browser's guess", () => {
    onDisplay(1920, 1080, 1);
    terminalFontStore.setShellDisplay("left-monitor");
    terminalFontStore.set(13);
    terminalFontStore.setShellDisplay("right-monitor");
    terminalFontStore.set(20);

    terminalFontStore.setShellDisplay("left-monitor");

    expect(terminalFontStore.get()).toBe(13);
    expect(terminalFontStore.displayKey()).toBe("left-monitor");
  });

  it("emits when a display change picks a different size", () => {
    onDisplay(1440, 900, 2);
    terminalFontStore.set(11);
    onDisplay(3840, 2160, 1);
    terminalFontStore.set(16);
    const listener = vi.fn();
    const off = terminalFontStore.subscribe(listener);

    onDisplay(1440, 900, 2);
    off();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("names the browser display by its size and pixel ratio", () => {
    vi.spyOn(window.screen, "width", "get").mockReturnValue(1512);
    vi.spyOn(window.screen, "height", "get").mockReturnValue(982);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);

    const key = browserDisplayKey();

    expect(key).toBe("1512x982@2");
  });

  describe("watchDisplayChanges", () => {
    afterEach(() => {
      delete window.codechromaDesktop;
      resetDisplayWatchForTests();
    });

    it("hooks up the shell's display once its script is injected after the first terminal", () => {
      watchDisplayChanges();
      let listener: ((command: AgentCommand) => void) | undefined;
      const api: Partial<DesktopWorkspaceApi> = { displayKey: () => "left", onAgentCommand: (fn) => void (listener = fn) };
      window.codechromaDesktop = api as DesktopWorkspaceApi;
      window.dispatchEvent(new Event(DESKTOP_READY_EVENT));
      const first = terminalFontStore.displayKey();

      listener?.({ type: "display", key: "right" });

      expect([first, terminalFontStore.displayKey()]).toEqual(["left", "right"]);
    });
  });
});
