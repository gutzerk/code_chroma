import { describe, expect, it } from "vitest";
import { agentsWideWidth, chromeInsets, Z_AGENTS, Z_CODE, Z_POPOVER } from "./layoutMetrics";

describe("chromeInsets", () => {
  it("returns open-panel offsets with normal agents", () => {
    const insets = chromeInsets({ leftOpen: true, agentsMode: "normal" });

    expect(insets).toEqual({
      terminalLeft: 286,
      terminalRight: 424,
      arrangeOrigin: { x: 290, y: 28 },
    });
  });

  it("returns collapsed-panel offsets with non-normal agents", () => {
    const insets = chromeInsets({ leftOpen: false, agentsMode: "collapsed" });

    expect(insets).toEqual({
      terminalLeft: 12,
      terminalRight: 68,
      arrangeOrigin: { x: 28, y: 76 },
    });
  });

  it("keeps the z-index ladder ordered", () => {
    expect(Z_AGENTS).toBeLessThan(Z_CODE);
    expect(Z_CODE).toBeLessThan(Z_POPOVER);
  });
});

describe("agentsWideWidth", () => {
  it("stops at the open left panel edge", () => {
    expect(agentsWideWidth(1400, true)).toBe(1400 - 286 - 12);
  });

  it("stops at the chrome inset when the left panel is closed", () => {
    expect(agentsWideWidth(1400, false)).toBe(1400 - 12 - 12);
  });

  it("never drops below the minimum width", () => {
    expect(agentsWideWidth(300, true)).toBe(400);
  });
});
