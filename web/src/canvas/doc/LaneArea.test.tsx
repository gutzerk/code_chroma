import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LaneArea } from "./LaneArea";
import { laneColorIndex } from "./laneColor";
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

describe("LaneArea", () => {
  it("renders nothing for an empty member list", () => {
    render(<LaneArea lane="Frontend" members={[]} sizes={new Map()} />);

    expect(screen.queryByTestId("canvas-lane-area")).not.toBeInTheDocument();
  });

  it("sizes the area to enclose every member's default-sized box, plus padding", () => {
    const members = [
      elementOf({ id: "m1", position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", position: { x: 500, y: 300 } }),
    ];

    render(<LaneArea lane="Frontend" members={members} sizes={new Map()} />);

    const area = screen.getByTestId("canvas-lane-area");
    // m1: left=-10..210, top=64..136. m2: left=390..610, top=264..336.
    // Union: left=-10, top=64, right=610, bottom=336 (width 620, height 272). Padding: side=24, top=40, bottom=24.
    expect(area.style.left).toBe("-34px");
    expect(area.style.top).toBe("24px");
    expect(area.style.width).toBe("668px");
    expect(area.style.height).toBe("336px");
    expect(screen.getByText("Frontend")).toBeInTheDocument();
  });

  it("colors the area off a hash of the lane name, so the same name is always the same color", () => {
    const members = [elementOf({ id: "m1" })];

    render(<LaneArea lane="Frontend" members={members} sizes={new Map()} />);

    const area = screen.getByTestId("canvas-lane-area");
    expect(area.className).toContain(`canvas-lane-area-color-${laneColorIndex("Frontend")}`);
  });
});
