import { describe, expect, it } from "vitest";
import { chromeInsets, Z_AGENTS, Z_CODE, Z_POPOVER } from "./layoutMetrics";

describe("chromeInsets", () => {
  it("returns open-panel offsets with normal agents", () => {
    const insets = chromeInsets({ leftOpen: true, agentsMode: "normal" });

    expect(insets).toEqual({
      terminalLeft: 286,
      terminalRight: 424,
      arrangeOrigin: { x: 290, y: 28 },
      drawPopover: { left: 286, top: 10 },
    });
  });

  it("returns collapsed-panel offsets with non-normal agents", () => {
    const insets = chromeInsets({ leftOpen: false, agentsMode: "collapsed" });

    expect(insets).toEqual({
      terminalLeft: 12,
      terminalRight: 68,
      arrangeOrigin: { x: 28, y: 76 },
      drawPopover: { left: 68, top: 10 },
    });
  });

  it("keeps the z-index ladder ordered", () => {
    expect(Z_AGENTS).toBeLessThan(Z_CODE);
    expect(Z_CODE).toBeLessThan(Z_POPOVER);
  });
});
