import { describe, expect, it } from "vitest";
import { zoomLevelFor } from "./layoutMetrics";

describe("zoomLevelFor", () => {
  it.each([
    [1, "full"],
    [0.6, "full"],
    [0.59, "mid"],
    [0.3, "mid"],
    [0.29, "far"],
  ])("scale %s is %s", (scale, level) => {
    expect(zoomLevelFor(scale)).toBe(level);
  });
});
