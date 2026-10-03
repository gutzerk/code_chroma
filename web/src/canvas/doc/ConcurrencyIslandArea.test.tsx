import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConcurrencyIslandArea } from "./ConcurrencyIslandArea";
import { concurrencyIslandColorIndex } from "./concurrencyIslandColor";
import type { CanvasElement } from "../../state/types";

function elementOf(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "custom",
    layer: "default",
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

describe("ConcurrencyIslandArea", () => {
  it("renders nothing for an empty member list", () => {
    render(<ConcurrencyIslandArea digits="2" members={[]} sizes={new Map()} />);

    expect(screen.queryByTestId("canvas-concurrency-island")).not.toBeInTheDocument();
  });

  it("sizes the area to enclose every member's default-sized box, plus padding", () => {
    const members = [
      elementOf({ id: "m1", position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", position: { x: 500, y: 300 } }),
    ];

    render(<ConcurrencyIslandArea digits="2" members={members} sizes={new Map()} />);

    const island = screen.getByTestId("canvas-concurrency-island");
    // m1: left=-50..150, top=64..136. m2: left=350..650, top=264..336.
    // Union: left=-50, top=64, right=650, bottom=336 (width 700, height 272). Padding: side=16, top=32, bottom=16.
    expect(island.style.left).toBe("-66px");
    expect(island.style.top).toBe("32px");
    expect(island.style.width).toBe("732px");
    expect(island.style.height).toBe("320px");
    expect(screen.getByText("Concurrent: 2")).toBeInTheDocument();
  });

  it("colors the island off a hash of the shared digit run, so the same digits are always the same color", () => {
    const members = [elementOf({ id: "m1" })];

    render(<ConcurrencyIslandArea digits="2" members={members} sizes={new Map()} />);

    const island = screen.getByTestId("canvas-concurrency-island");
    expect(island.className).toContain(`canvas-concurrency-island-color-${concurrencyIslandColorIndex("2")}`);
  });
});
