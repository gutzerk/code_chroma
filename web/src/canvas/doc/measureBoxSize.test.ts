import { describe, expect, it } from "vitest";
import { measureBoxSize } from "./measureBoxSize";
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
