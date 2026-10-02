import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CodeView } from "./CodeView";
import { collisionStore } from "./collision/collisionStore";
import type { HierarchyNodeRef } from "../state/types";

const NODE: HierarchyNodeRef = {
  node_id: "function::example",
  name: "example",
  level: "function",
  parent_id: "file::example.py",
  has_children: false,
  child_count: 0,
  params: "(a: int) -> int",
  source: "def example(a: int) -> int:\n    return a",
  language: "python",
};

function readTransform(panel: HTMLElement) {
  const match = panel.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
  if (!match) throw new Error(`unexpected transform: ${panel.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

function drag(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("CodeView dragging", () => {
  it("moves a draggable panel by the pointer delta when dragging the header", () => {
    render(<CodeView node={NODE} draggable />);
    const panel = screen.getByTestId("block-code-view");
    const header = screen.getByTestId("block-code-view-header");
    expect(readTransform(panel)).toEqual({ x: 0, y: 0 });

    drag(header, { x: 100, y: 100 }, { x: 140, y: 130 });

    expect(readTransform(panel)).toEqual({ x: 40, y: 30 });
  });

  it.each([
    ["the drag never crosses the movement threshold", "block-code-view-header", { x: 101, y: 101 }],
    ["the drag starts on the source area", "block-code-view-source", { x: 140, y: 130 }],
  ])("does not move when %s", (_case, handleTestId, to) => {
    render(<CodeView node={NODE} draggable />);
    const panel = screen.getByTestId("block-code-view");

    drag(screen.getByTestId(handleTestId), { x: 100, y: 100 }, to);

    expect(readTransform(panel)).toEqual({ x: 0, y: 0 });
  });

  it("applies no transform and no grip without the draggable prop", () => {
    render(<CodeView node={NODE} />);
    const panel = screen.getByTestId("block-code-view");

    drag(screen.getByTestId("block-code-view-header"), { x: 100, y: 100 }, { x: 140, y: 130 });

    expect(panel.style.transform).toBe("");
    expect(panel.querySelector(".block-code-view-grip")).toBeNull();
  });

  it("divides screen-pixel deltas by the canvas scale measured at drag start", () => {
    render(<CodeView node={NODE} draggable />);
    const panel = screen.getByTestId("block-code-view");
    const header = screen.getByTestId("block-code-view-header");
    // Rendered width 200 vs layout width 100 simulates the canvas zoomed to scale 2.
    header.getBoundingClientRect = () => ({ width: 200 }) as DOMRect;
    Object.defineProperty(header, "offsetWidth", { value: 100 });

    drag(header, { x: 100, y: 100 }, { x: 140, y: 130 });

    expect(readTransform(panel)).toEqual({ x: 20, y: 15 });
  });
});

describe("CodeView resizing", () => {
  it("does not render a resize handle without the resizable prop", () => {
    render(<CodeView node={NODE} draggable />);
    expect(screen.queryByTestId("block-code-view-resize-handle")).not.toBeInTheDocument();
  });

  it("grows a resizable panel by the drag delta, clearing the default max-width/max-height cap", () => {
    render(<CodeView node={NODE} className="block-code-view--inline" draggable resizable />);
    const panel = screen.getByTestId("block-code-view");
    const handle = screen.getByTestId("block-code-view-resize-handle");

    drag(handle, { x: 100, y: 100 }, { x: 500, y: 400 });

    expect(panel.style.width).toBe("400px");
    expect(panel.style.height).toBe("300px");
    expect(panel.style.maxWidth).toBe("none");
    expect(panel.style.maxHeight).toBe("none");
  });

  it("never shrinks the panel below the minimum size", () => {
    render(<CodeView node={NODE} className="block-code-view--inline" draggable resizable />);
    const panel = screen.getByTestId("block-code-view");
    const handle = screen.getByTestId("block-code-view-resize-handle");

    drag(handle, { x: 100, y: 100 }, { x: 110, y: 105 });

    expect(panel.style.width).toBe("320px");
    expect(panel.style.height).toBe("200px");
  });

  it("divides screen-pixel resize deltas by the canvas scale measured at resize start", () => {
    render(<CodeView node={NODE} className="block-code-view--inline" draggable resizable />);
    const panel = screen.getByTestId("block-code-view");
    const handle = screen.getByTestId("block-code-view-resize-handle");
    // Rendered width 200 vs layout width 100 simulates the canvas zoomed to scale 2.
    handle.getBoundingClientRect = () => ({ width: 200 }) as DOMRect;
    Object.defineProperty(handle, "offsetWidth", { value: 100 });

    drag(handle, { x: 100, y: 100 }, { x: 500, y: 400 });

    expect(panel.style.width).toBe("320px"); // (400 / 2 = 200) still clamped to the 320px floor
    expect(panel.style.height).toBe("200px"); // (300 / 2 = 150) still clamped to the 200px floor
  });

  // 🔴 The collision exemption, proven structurally: a code panel is a window over the map, so it must
  // never enter collisionStore — a participant would be shoved off a block it was parked on, and there
  // is no undo. Opting in is a per-call-site decision (useCollisionAvoidance), and this call site
  // deliberately calls useDragOffset bare. Previously proven in e2e by dropping a panel onto a C1 box,
  // which stopped being reachable when real code moved into the inspector panel.
  it("never registers as a collision participant, however it is configured", () => {
    render(<CodeView node={NODE} className="block-code-view--inline" draggable resizable />);
    const panel = screen.getByTestId("block-code-view");
    panel.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);

    drag(screen.getByTestId("block-code-view-header"), { x: 100, y: 100 }, { x: 180, y: 160 });

    expect(collisionStore.rectsExcept("someone-else", 1)).toEqual([]);
    expect(readTransform(panel)).toEqual({ x: 80, y: 60 });
  });
});
