import { describe, expect, it } from "vitest";
import { fitNameFontSize, measureBoxSize } from "./measureBoxSize";
import type { CanvasElement } from "../../state/types";

function el(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: "a",
    render: "custom",
    layer: "x",
    label: "Box",
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

describe("measureBoxSize", () => {
  it("makes a box with a longer description taller", () => {
    const short = el({ description: "short text" });
    const long = el({ description: "a much longer description ".repeat(6) });

    const a = measureBoxSize(short);
    const b = measureBoxSize(long);

    expect(b!.h).toBeGreaterThan(a!.h);
  });

  it("lets an authored size win", () => {
    const sized = el({ size: { w: 410, h: 123 }, description: "long ".repeat(80) });

    const result = measureBoxSize(sized);

    expect(result).toEqual({ w: 410, h: 123 });
  });

  it("caps the description at the four-line clamp", () => {
    const four = el({ description: "word ".repeat(60) });
    const huge = el({ description: "word ".repeat(2000) });

    const a = measureBoxSize(four);
    const b = measureBoxSize(huge);

    expect(b!.h).toBe(a!.h);
  });

  it("skips self-sized render kinds", () => {
    const note = el({ render: "note" });

    const result = measureBoxSize(note);

    expect(result).toBeNull();
  });
});

describe("fitNameFontSize", () => {
  it("sets a short name larger than a long one in the same box", () => {
    const short = fitNameFontSize("Auth", 300, 120);
    const long = fitNameFontSize("Rewrite every changed architecture page", 300, 120);

    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThan(14);
  });

  it("fills the padded height with a one-word name, one line tall", () => {
    const px = fitNameFontSize("Auth", 300, 120);

    expect(px).toBe(Math.floor((120 - 20) / 1.15));
  });

  it("grows with the box", () => {
    const small = fitNameFontSize("Checkout", 160, 40);
    const big = fitNameFontSize("Checkout", 320, 80);

    expect(big).toBeGreaterThan(small);
  });

  it("never goes below the 8px floor", () => {
    const px = fitNameFontSize("word ".repeat(200), 100, 30);

    expect(px).toBe(8);
  });
});
