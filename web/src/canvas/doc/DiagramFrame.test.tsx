import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiagramFrame } from "./DiagramFrame";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { groupColorIndex } from "./groupColor";
import { canvasDocStore } from "./canvasDocStore";
import { dragOffsetStore } from "./dragOffsetStore";
import { undoStore } from "../../state/undoStore";
import { CANVAS_STUB } from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";

function element(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "custom",
    layer: "c1",
    label: "Box",
    description: "",
    node_id: null,
    position: { x: 100, y: 100 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

const client = {
  ...CANVAS_STUB,
  getCanvas: async () => canvasDocStore.getDoc(),
} as unknown as EngineClient;

function setDoc(elements: CanvasElement[]) {
  canvasDocStore.setDoc({
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries(elements.map((el) => [el.id, el])),
  });
}

function renderFrame(layer: string, label: string, members: CanvasElement[]) {
  return render(
    <EngineClientProvider repoId="default" client={client}>
      <DiagramFrame layer={layer} label={label} members={members} sizes={new Map()} />
    </EngineClientProvider>,
  );
}

describe("DiagramFrame", () => {
  afterEach(() => {
    canvasDocStore.reset();
    dragOffsetStore.reset();
    undoStore.reset();
  });

  it("renders nothing for a diagram with no visible members", () => {
    renderFrame("c1", "C1", []);

    expect(screen.queryByTestId("canvas-diagram-frame")).not.toBeInTheDocument();
  });

  it("sizes the frame to enclose every member's default-sized box, plus padding, and shows the label", () => {
    const members = [
      element({ id: "m1", position: { x: 100, y: 100 } }),
      element({ id: "m2", position: { x: 500, y: 300 } }),
    ];

    renderFrame("c1", "C1", members);

    const frame = screen.getByTestId("canvas-diagram-frame");
    // m1: left=-10..210, top=64..136. m2: left=390..610, top=264..336.
    // Union: left=-10, top=64, right=610, bottom=336. Padding: side=40, top=93, bottom=40
    // (GroupFrame's own padding + NESTED_GAP, so a group's frame at this diagram's edge stays
    // inside it with room to spare, instead of touching or poking past it, plus this frame's own
    // title label's rendered height + 15% buffer, so it never crowds a plain topmost member's title).
    expect(frame.style.left).toBe("-50px");
    expect(frame.style.top).toBe("-29px");
    expect(frame.style.width).toBe("700px");
    expect(frame.style.height).toBe("405px");
    expect(screen.getByText("C1")).toBeInTheDocument();
  });

  it("exposes itself as a keyboard-reachable, labeled control", () => {
    renderFrame("c1", "C1", [element({ id: "m1" })]);

    const frame = screen.getByTestId("canvas-diagram-frame");
    expect(frame.getAttribute("role")).toBe("button");
    expect(frame.getAttribute("tabIndex")).toBe("0");
    expect(frame.getAttribute("aria-label")).toBe("Drag to move the C1 diagram");
  });

  it("colors a builtin kind's frame off its own fixed class", () => {
    renderFrame("patterns", "Design patterns", [element({ id: "m1" })]);

    expect(screen.getByTestId("canvas-diagram-frame").className).toContain(
      "canvas-diagram-frame-patterns",
    );
  });

  it("colors a non-builtin layer's frame off a hash of the layer key, like GroupFrame", () => {
    renderFrame("custom/my-type", "My type", [element({ id: "m1" })]);

    expect(screen.getByTestId("canvas-diagram-frame").className).toContain(
      `canvas-diagram-frame-color-${groupColorIndex("custom/my-type")}`,
    );
  });

  it("dragging the frame moves every member on that layer by the same delta, in one batched commit", () => {
    const a = element({ id: "a", layer: "c1", position: { x: 100, y: 100 } });
    const b = element({ id: "b", layer: "c1", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    renderFrame("c1", "C1", [a, b]);
    const frame = screen.getByTestId("canvas-diagram-frame");

    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(dragOffsetStore.getAll()).toEqual({
      a: { x: 30, y: 20 },
      b: { x: 30, y: 20 },
    });

    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 130, y: 120 });
    expect(canvasDocStore.getDoc().elements.b.position).toEqual({ x: 430, y: 120 });
    expect(dragOffsetStore.getAll()).toEqual({});
  });

  it("records the pre-drag positions as one undoable 'canvas' commit", () => {
    const a = element({ id: "a", layer: "c1", position: { x: 100, y: 100 } });
    const b = element({ id: "b", layer: "c1", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    renderFrame("c1", "C1", [a, b]);
    const frame = screen.getByTestId("canvas-diagram-frame");

    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(undoStore.canUndo("canvas")).toBe(true);
    expect(undoStore.undo("canvas")).toEqual({
      a: { x: 100, y: 100 },
      b: { x: 400, y: 100 },
    });
  });

  it("clears every member's live offset if the frame unmounts mid-drag, instead of leaving them stuck", () => {
    const a = element({ id: "a", layer: "c1", position: { x: 100, y: 100 } });
    const b = element({ id: "b", layer: "c1", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    const { unmount } = renderFrame("c1", "C1", [a, b]);
    const frame = screen.getByTestId("canvas-diagram-frame");

    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    expect(dragOffsetStore.getAll()).toEqual({ a: { x: 30, y: 20 }, b: { x: 30, y: 20 } });

    // The diagram gets deleted (or its layer collapsed) by another window/agent mid-gesture -- no
    // pointerup ever reaches this drag, so onGroupCommit never runs.
    unmount();

    expect(dragOffsetStore.getAll()).toEqual({});
  });
});
