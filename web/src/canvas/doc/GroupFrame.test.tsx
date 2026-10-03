import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupFrame } from "./GroupFrame";
import { groupColorIndex } from "./groupColor";
import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";

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

function groupOf(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return elementOf({ render: "group", label: "External integrations", ...overrides });
}

function memberOf(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return elementOf({ label: "Member", group_id: "g1", ...overrides });
}

describe("GroupFrame", () => {
  it("renders nothing for a group with no visible members", () => {
    const group = groupOf({ id: "g1" });

    render(<GroupFrame element={group} members={[]} sizes={new Map()} />);

    expect(screen.queryByTestId("canvas-group-frame")).not.toBeInTheDocument();
  });

  it("sizes the frame to enclose every member's default-sized box, plus padding", () => {
    const group = groupOf({ id: "g1" });
    const members = [
      memberOf({ id: "m1", position: { x: 100, y: 100 } }),
      memberOf({ id: "m2", position: { x: 500, y: 300 } }),
    ];

    render(<GroupFrame element={group} members={members} sizes={new Map()} />);

    const frame = screen.getByTestId("canvas-group-frame");
    // m1: left=-50..150, top=64..136. m2: left=350..650, top=264..336.
    // Union: left=-50, top=64, right=650, bottom=336. Padding: side=32, top=48, bottom=32.
    expect(frame.style.left).toBe("-82px");
    expect(frame.style.top).toBe("16px");
    expect(frame.style.width).toBe("764px");
    expect(frame.style.height).toBe("352px");
    expect(screen.getByText("External integrations")).toBeInTheDocument();
  });

  it("prefers a member's real measured size/margin over its assumed default", () => {
    const group = groupOf({ id: "g1" });
    const members = [memberOf({ id: "m1", position: { x: 100, y: 100 } })];
    const sizes = new Map<string, MeasuredBoxSize>([
      ["m1", { width: 300, height: 150, marginLeft: 5, marginTop: 5 }],
    ]);

    render(<GroupFrame element={group} members={members} sizes={sizes} />);

    const frame = screen.getByTestId("canvas-group-frame");
    // Assumed default box centers the member (100 - 150, 100 - 36) = (-50, 64), then margin shifts
    // the measured border-box by (5, 5): left=-45, top=69, right=-45+300=255, bottom=69+150=219.
    expect(frame.style.left).toBe("-77px");
    expect(frame.style.top).toBe("21px");
    expect(frame.style.width).toBe("364px");
    expect(frame.style.height).toBe("230px");
  });

  it("colors the frame off a hash of the group's own label, so the same name is always the same color", () => {
    const group = groupOf({ id: "g1", label: "Storage" });
    const members = [memberOf({ id: "m1" })];

    render(<GroupFrame element={group} members={members} sizes={new Map()} />);

    const frame = screen.getByTestId("canvas-group-frame");
    expect(frame.className).toContain(`canvas-group-frame-color-${groupColorIndex("Storage")}`);
  });
});
