import { describe, expect, it } from "vitest";
import { findOverlaps } from "./labelClearance";

describe("findOverlaps", () => {
  it("reports nothing when boxes don't touch", () => {
    const clashes = findOverlaps([
      { id: "a", box: { left: 0, top: 0, right: 10, bottom: 10 } },
      { id: "b", box: { left: 20, top: 20, right: 30, bottom: 30 } },
    ]);

    expect(clashes).toEqual([]);
  });

  it("flags two overlapping label chips", () => {
    const clashes = findOverlaps([
      { id: "label:a", box: { left: 0, top: 0, right: 10, bottom: 10 } },
      { id: "label:b", box: { left: 5, top: 5, right: 15, bottom: 15 } },
    ]);

    expect(clashes).toEqual([["label:a", "label:b"]]);
  });

  it("flags a label chip that overlaps a box", () => {
    const clashes = findOverlaps([
      { id: "label:edge", box: { left: 90, top: 40, right: 130, bottom: 60 } },
      { id: "box:function::charge", box: { left: 100, top: 0, right: 300, bottom: 80 } },
    ]);

    expect(clashes).toEqual([["label:edge", "box:function::charge"]]);
  });

  it("treats merely touching edges as clear, not overlapping", () => {
    const clashes = findOverlaps([
      { id: "a", box: { left: 0, top: 0, right: 10, bottom: 10 } },
      { id: "b", box: { left: 10, top: 0, right: 20, bottom: 10 } },
    ]);

    expect(clashes).toEqual([]);
  });

  it("stays clear on a representative diagram layout of boxes and their edge labels", () => {
    const clashes = findOverlaps([
      { id: "box:function::create_order", box: { left: 0, top: 0, right: 200, bottom: 60 } },
      { id: "box:function::apply_discount", box: { left: 400, top: 0, right: 600, bottom: 60 } },
      { id: "box:function::charge", box: { left: 800, top: 0, right: 1000, bottom: 60 } },
      { id: "label:calls", box: { left: 260, top: 22, right: 320, bottom: 38 } },
      { id: "label:then calls", box: { left: 660, top: 22, right: 740, bottom: 38 } },
    ]);

    expect(clashes).toEqual([]);
  });
});
