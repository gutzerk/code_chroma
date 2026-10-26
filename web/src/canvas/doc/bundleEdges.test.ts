import { describe, expect, it } from "vitest";
import { bundleEdges } from "./bundleEdges";

const edge = (id: string, from: string, to: string, label = "", hero = false) => ({
  id, from, to, label, kind: "", layer: "l", hero,
});

describe("bundleEdges", () => {
  it("merges parallel edges into one with a count", () => {
    const out = bundleEdges([edge("1", "a", "b", "calls"), edge("2", "a", "b", "", true), edge("3", "b", "a")]);

    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("calls ×2");
    expect(out[0].hero).toBe(true);
  });

  it("leaves single edges untouched", () => {
    const single = edge("1", "a", "b", "x");

    expect(bundleEdges([single])).toEqual([single]);
  });
});
