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

  it("keeps every distinct label of the merged edges", () => {
    const out = bundleEdges([edge("1", "a", "b", "reads config"), edge("2", "a", "b", "writes cache")]);

    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("reads config · writes cache ×2");
  });

  it("leaves single edges untouched", () => {
    const single = edge("1", "a", "b", "x");

    expect(bundleEdges([single])).toEqual([single]);
  });

  it("keeps parallel edges with different origins apart", () => {
    const out = bundleEdges([
      { ...edge("1", "a", "b", "x"), origin: "a.py:1" },
      { ...edge("2", "a", "b", "x"), origin: "a.py:9" },
    ]);

    expect(out).toHaveLength(2);
  });

  it("keeps parallel edges from different layers or kinds apart", () => {
    const calls = edge("1", "a", "b", "x");
    const out = bundleEdges([
      { ...calls, layer: "c1", kind: "calls" },
      { ...calls, id: "2", layer: "impact", kind: "calls" },
      { ...calls, id: "3", layer: "c1", kind: "error" },
    ]);

    expect(out).toHaveLength(3);
  });
});
