import { afterEach, describe, expect, it } from "vitest";
import { codeViewModeStore } from "./codeViewModeStore";

afterEach(() => {
  codeViewModeStore.reset();
});

describe("codeViewModeStore", () => {
  it("defaults to inline mode", () => {
    expect(codeViewModeStore.getMode()).toBe("inline");
  });

  it("toggles between inline and popup", () => {
    codeViewModeStore.toggle();
    expect(codeViewModeStore.getMode()).toBe("popup");

    codeViewModeStore.toggle();
    expect(codeViewModeStore.getMode()).toBe("inline");
  });

  it("sets a mode outright", () => {
    codeViewModeStore.setMode("popup");
    expect(codeViewModeStore.getMode()).toBe("popup");
  });
});
