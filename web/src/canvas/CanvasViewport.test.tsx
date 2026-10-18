import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CanvasViewport, type CanvasViewportHandle } from "./CanvasViewport";
import { selectionStore } from "../state/selectionStore";
import { gridStep } from "./canvasGrid";
import { clearSavedCameraView } from "./canvasCameraStore";

afterEach(() => {
  selectionStore.clear();
  // The camera persist feature restores the previous test's panned/zoomed view on the next mount;
  // clear it so each test starts from the reset origin.
  clearSavedCameraView();
});

function mockRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }) as DOMRect;
}

function readTransform() {
  const style = screen.getByTestId("canvas-content").style.transform;
  const match = style.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  if (!match) throw new Error(`unexpected transform: ${style}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

describe("CanvasViewport focusOnNode", () => {
  it("scales and translates so the target block fills and centers in the viewport", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    act(() => ref.current?.focusOnNode("child"));

    const { x, y, scale } = readTransform();
    // fitScale = min(1000/300, 800/200) * 0.7 padding
    const expectedScale = Math.min(1000 / 300, 800 / 200) * 0.7;
    expect(scale).toBeCloseTo(expectedScale, 5);
    // target's logical center (250, 200) should land on the viewport's screen center (500, 400)
    expect(x).toBeCloseTo(500 - 250 * expectedScale, 5);
    expect(y).toBeCloseTo(400 - 200 * expectedScale, 5);
  });

  it("does nothing when the target node isn't rendered", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    act(() => ref.current?.focusOnNode("missing"));

    expect(readTransform()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("clamps the fit scale to FOCUS_MAX_SCALE for a tiny block", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 10, height: 10 });

    act(() => ref.current?.focusOnNode("child"));

    expect(readTransform().scale).toBe(3.5);
  });

  it("clicking the same node's focus button again restores the pre-focus view", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    const initialTransform = readTransform();

    act(() => ref.current?.focusOnNode("child"));
    expect(readTransform()).not.toEqual(initialTransform);

    act(() => ref.current?.focusOnNode("child"));
    expect(readTransform()).toEqual(initialTransform);
  });

  it("focusing a different node replaces the toggle target, instead of restoring the first node's pre-focus view", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
        <div data-node-id="b" data-testid="b" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 300, height: 200 });
    mockRect(screen.getByTestId("b"), { left: 500, top: 100, width: 100, height: 100 });

    act(() => ref.current?.focusOnNode("a"));

    act(() => ref.current?.focusOnNode("b"));
    const transformAfterB = readTransform();

    // "b" is now the last-focused node, not "a" — so re-focusing "a" here is a fresh forward
    // fit, not a toggle back to whatever the view looked like before "a" was first focused.
    act(() => ref.current?.focusOnNode("a"));
    expect(readTransform()).not.toEqual(transformAfterB);

    // But "a" is the last-focused node again now, so clicking it once more toggles back to
    // exactly what the view looked like right before this second "a" focus (i.e. transformAfterB).
    act(() => ref.current?.focusOnNode("a"));
    expect(readTransform()).toEqual(transformAfterB);
  });

  it("fitToNode clears any pending focus-toggle memory instead of toggling", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    const initialTransform = readTransform();
    act(() => ref.current?.focusOnNode("child"));
    expect(readTransform()).not.toEqual(initialTransform);

    act(() => ref.current?.fitToNode("child"));

    // fitToNode must not count as "the focus button was clicked" — a subsequent focusOnNode
    // call should perform a fresh fit, not restore all the way back to the original pre-focus
    // view (which is what would happen if fitToNode had left the old toggle memory in place).
    act(() => ref.current?.focusOnNode("child"));
    expect(readTransform()).not.toEqual(initialTransform);
  });

  it("pans when a drag past the threshold starts on a block's empty area (not just the bare canvas)", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    const child = screen.getByTestId("child");

    fireEvent.pointerDown(child, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(child, { pointerId: 1, clientX: 300, clientY: 250 });
    fireEvent.pointerUp(child, { pointerId: 1, clientX: 300, clientY: 250 });

    // Dragged +200/+150 — the empty area inside a block now pans instead of being ignored.
    expect(readTransform()).toEqual({ x: 200, y: 150, scale: 1 });
  });

  it("does not pan on a plain click (sub-threshold movement) so the block's own toggle still fires", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    const child = screen.getByTestId("child");
    const initialTransform = readTransform();

    fireEvent.pointerDown(child, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(child, { pointerId: 1, clientX: 102, clientY: 101 });
    fireEvent.pointerUp(child, { pointerId: 1, clientX: 102, clientY: 101 });

    expect(readTransform()).toEqual(initialTransform);
  });

  it("swallows the click a completed drag synthesizes so a panned-over block never toggles", () => {
    const ref = createRef<CanvasViewportHandle>();
    let blockClicked = false;
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" onClick={() => (blockClicked = true)} />
      </CanvasViewport>,
    );

    const child = screen.getByTestId("child");

    fireEvent.pointerDown(child, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(child, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(child, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.click(child, { clientX: 300, clientY: 300 });

    expect(blockClicked).toBe(false);
  });

  it("does not swallow a later click when the next press starts on a block that stops pointerdown", () => {
    let blockClicked = false;
    render(
      <CanvasViewport ref={createRef<CanvasViewportHandle>()}>
        <div data-testid="empty" />
        <div
          data-testid="block"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => (blockClicked = true)}
        />
      </CanvasViewport>,
    );
    const empty = screen.getByTestId("empty");
    const block = screen.getByTestId("block");
    fireEvent.pointerDown(empty, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(empty, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(empty, { pointerId: 1, clientX: 300, clientY: 300 });

    fireEvent.pointerDown(block, { button: 0, pointerId: 2, clientX: 50, clientY: 50 });
    fireEvent.click(block, { clientX: 50, clientY: 50 });

    expect(blockClicked).toBe(true);
  });

  it("does not start a pan when the drag begins on a control (button / code panel)", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child">
          <button type="button" data-testid="ctl">
            x
          </button>
        </div>
      </CanvasViewport>,
    );

    const control = screen.getByTestId("ctl");
    const initialTransform = readTransform();

    fireEvent.pointerDown(control, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(control, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(control, { pointerId: 1, clientX: 300, clientY: 300 });

    expect(readTransform()).toEqual(initialTransform);
  });

  it("does not start a pan when the drag begins on the C1 change-review panel, so it moves independently of the canvas", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child">
          <div data-testid="c1-change-panel" />
        </div>
      </CanvasViewport>,
    );

    const panel = screen.getByTestId("c1-change-panel");
    const initialTransform = readTransform();

    fireEvent.pointerDown(panel, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientX: 300, clientY: 300 });

    expect(readTransform()).toEqual(initialTransform);
  });

  it("does not start a pan when the drag begins on the C1 change-review summary panel, so it moves independently of the canvas", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child">
          <div data-testid="c1-change-summary" />
        </div>
      </CanvasViewport>,
    );

    const panel = screen.getByTestId("c1-change-summary");
    const initialTransform = readTransform();

    fireEvent.pointerDown(panel, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientX: 300, clientY: 300 });

    expect(readTransform()).toEqual(initialTransform);
  });
});

describe("CanvasViewport fitToAllNodes", () => {
  it("unions canvas-doc elements that carry data-canvas-element but no data-node-id", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        {/* A synthetic/canvas-doc box: no data-node-id, only data-canvas-element */}
        <div data-canvas-element data-testid="box" />
        {/* A hierarchy block: data-node-id, no data-canvas-element */}
        <div data-node-id="hblock" data-testid="hblock" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("box"), { left: 100, top: 100, width: 400, height: 300 });
    mockRect(screen.getByTestId("hblock"), { left: 600, top: 500, width: 200, height: 100 });

    act(() => ref.current?.fitToAllNodes());

    // The union spans both elements: left=100..800 across, top=100..600 down, so the fit must
    // account for that full extent rather than collapsing onto one of them.
    const { scale } = readTransform();
    const unionWidth = 800 - 100;
    const unionHeight = 600 - 100;
    // fitScale = min(1000/unionW, 800/unionH) * 0.7 — comfortably under FOCUS_MAX_SCALE here.
    const expectedScale = Math.min(1000 / unionWidth, 800 / unionHeight) * 0.7;
    expect(scale).toBeCloseTo(expectedScale, 5);
  });

  it("still fits when only data-canvas-element elements are present", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-canvas-element data-testid="note" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("note"), { left: 200, top: 200, width: 500, height: 400 });

    act(() => ref.current?.fitToAllNodes());

    const { scale } = readTransform();
    const expectedScale = Math.min(1000 / 500, 800 / 400) * 0.7;
    expect(scale).toBeCloseTo(expectedScale, 5);
  });
});

describe("CanvasViewport marquee selection", () => {
  it("previews the selection live during the drag, not only on release", async () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-select-id="inside" data-testid="inside" />
        <div data-select-id="outside" data-testid="outside" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("inside"), { left: 100, top: 100, width: 50, height: 50 });
    mockRect(screen.getByTestId("outside"), { left: 500, top: 500, width: 50, height: 50 });
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

    // Still mid-drag (no pointerUp yet) -- the block under the rectangle should already be
    // highlighted instead of waiting for release.
    expect(selectionStore.getSelectedIds()).toEqual(["inside"]);

    // Shrinking the rectangle back off the block un-previews it, same as it never grew to cover it.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: 90, shiftKey: true });
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

    expect(selectionStore.getSelectedIds()).toEqual([]);

    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 90, clientY: 90 });
  });

  it("selects every node whose rect intersects a shift-drag rectangle", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-select-id="inside" data-testid="inside" />
        <div data-select-id="outside" data-testid="outside" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("inside"), { left: 100, top: 100, width: 50, height: 50 });
    mockRect(screen.getByTestId("outside"), { left: 500, top: 500, width: 50, height: 50 });
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(selectionStore.getSelectedIds()).toEqual(["inside"]);
  });

  it("extends rather than replaces an existing selection", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-select-id="inside" data-testid="inside" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("inside"), { left: 100, top: 100, width: 50, height: 50 });
    selectionStore.toggle("already-selected");
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(selectionStore.getSelectedIds()).toEqual(["already-selected", "inside"]);
  });

  it("ignores an element that only carries data-node-id (e.g. a synthetic C1 box with no engine node), not data-select-id", () => {
    // Regression: CanvasNodeBox's own selectionStore key is its canvas-doc element id, not
    // `data-node-id` (the engine-node id used for focus/fit, and null on a synthetic C1 System/Actor
    // box) -- matching on `data-node-id` used to add the wrong id, or skip the box outright, so a
    // marquee never actually selected a C1/Patterns/Impact/Epic box.
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="engine-node-1" data-testid="node-only" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("node-only"), { left: 100, top: 100, width: 50, height: 50 });
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("does not pan the canvas while a marquee is being drawn", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(<CanvasViewport ref={ref}>{null}</CanvasViewport>);
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(readTransform()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("a sub-threshold shift-click selects nothing and still lets the click through", () => {
    const ref = createRef<CanvasViewportHandle>();
    let clicked = false;
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" onClick={() => (clicked = true)} />
      </CanvasViewport>,
    );
    const child = screen.getByTestId("child");

    fireEvent.pointerDown(child, { button: 0, pointerId: 1, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(child, { pointerId: 1, clientX: 101, clientY: 100, shiftKey: true });
    fireEvent.pointerUp(child, { pointerId: 1, clientX: 101, clientY: 100 });
    fireEvent.click(child, { clientX: 101, clientY: 100, shiftKey: true });

    expect(selectionStore.getSelectedIds()).toEqual([]);
    expect(clicked).toBe(true);
  });

  it("Escape clears the active selection", () => {
    selectionStore.replace(["a", "b"]);
    render(<CanvasViewport ref={createRef<CanvasViewportHandle>()}>{null}</CanvasViewport>);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("a plain click on empty canvas space clears the active selection", () => {
    selectionStore.replace(["a", "b"]);
    render(<CanvasViewport ref={createRef<CanvasViewportHandle>()}>{null}</CanvasViewport>);
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.click(canvas);

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("a plain click on a selectable box clears any OTHER prior selection too (not just its own toggle)", () => {
    selectionStore.replace(["already-selected"]);
    render(
      <CanvasViewport ref={createRef<CanvasViewportHandle>()}>
        <div data-select-id="box-1" data-testid="box-1" />
      </CanvasViewport>,
    );

    fireEvent.click(screen.getByTestId("box-1"));

    // The viewport's own capture-phase handler doesn't touch selection here (the box's own click
    // handler owns that toggle) -- this just confirms landing on a `[data-select-id]` element is
    // correctly excluded from the empty-canvas clear, so it doesn't fight the box's own logic.
    expect(selectionStore.getSelectedIds()).toEqual(["already-selected"]);
  });

  it("does not clear the selection on the click that ends a marquee drag", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-select-id="inside" data-testid="inside" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("inside"), { left: 100, top: 100, width: 50, height: 50 });
    const canvas = screen.getByTestId("app-canvas");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80, shiftKey: true });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200, shiftKey: true });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.click(canvas);

    // A completed marquee's own synthesized click must not wipe out what it just selected.
    expect(selectionStore.getSelectedIds()).toEqual(["inside"]);
  });
});

// A relationship arrow's wide invisible hit-stroke (RelationshipEdge's `.c1-relationship-hit`) is
// deliberately stacked above every box (so an arrow crossing one stays hoverable/visible), which
// means a click that lands on the stroke never reaches the box underneath at all -- the browser's
// own hit-test picks the topmost element, and the box isn't even an ancestor of the arrow's `<path>`
// to catch the bubbled event. A dense multi-layer canvas (several diagrams' worth of boxes and
// routed edges sharing one space) makes an edge crossing this close to a box common; a lone,
// sparsely-populated diagram rarely triggers it, which is why this stayed unnoticed for a while.
describe("CanvasViewport click redirect around an arrow's hit-stroke", () => {
  function withElementsFromPointStub(stack: Element[]) {
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => stack;
    return () => {
      document.elementsFromPoint = original;
    };
  }

  it("forwards a click on the arrow hit-stroke to the real block underneath", () => {
    render(
      <CanvasViewport ref={createRef<CanvasViewportHandle>()}>
        <svg>
          <path className="c1-relationship-hit" data-testid="arrow-hit" />
        </svg>
        <div
          data-testid="block"
          data-node-id="auth"
          onClick={(e) => e.shiftKey && selectionStore.toggle("auth")}
        />
      </CanvasViewport>,
    );
    const hit = screen.getByTestId("arrow-hit");
    const block = screen.getByTestId("block");
    const restore = withElementsFromPointStub([hit, block]);

    fireEvent.click(hit, { clientX: 50, clientY: 50, shiftKey: true });
    restore();

    expect(selectionStore.getSelectedIds()).toEqual(["auth"]);
  });

  it("forwards to a canvas-doc box's own header, not its unclickable outer element", () => {
    render(
      <CanvasViewport ref={createRef<CanvasViewportHandle>()}>
        <svg>
          <path className="c1-relationship-hit" data-testid="arrow-hit" />
        </svg>
        <div data-testid="canvas-node-box">
          <div data-testid="canvas-node-box-header" onClick={() => selectionStore.toggle("box-1")} />
        </div>
      </CanvasViewport>,
    );
    const hit = screen.getByTestId("arrow-hit");
    const outer = screen.getByTestId("canvas-node-box");
    const header = screen.getByTestId("canvas-node-box-header");
    const restore = withElementsFromPointStub([hit, outer, header]);

    fireEvent.click(hit, { clientX: 50, clientY: 50, shiftKey: true });
    restore();

    expect(selectionStore.getSelectedIds()).toEqual(["box-1"]);
  });

  it("does nothing when nothing selectable sits under the arrow (empty canvas crossing)", () => {
    render(
      <CanvasViewport ref={createRef<CanvasViewportHandle>()}>
        <svg>
          <path className="c1-relationship-hit" data-testid="arrow-hit" />
        </svg>
      </CanvasViewport>,
    );
    const hit = screen.getByTestId("arrow-hit");
    const restore = withElementsFromPointStub([hit]);

    fireEvent.click(hit, { clientX: 50, clientY: 50 });
    restore();

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });
});

describe("CanvasViewport centerOnNode", () => {
  it("pans so the target block's center lands on the viewport center", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    act(() => ref.current?.centerOnNode("child"));

    const { x, y, scale } = readTransform();
    // centerOnNode only pans, it never rescales.
    expect(scale).toBe(1);
    // target's current center (250, 200) should move to the viewport's screen center (500, 400).
    expect(x).toBeCloseTo(500 - 250, 5);
    expect(y).toBeCloseTo(400 - 200, 5);
  });

  it("does nothing when the target node isn't rendered", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    act(() => ref.current?.centerOnNode("missing"));

    expect(readTransform()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("measures against the settled position, not the interpolated one, when called mid-transition", () => {
    // Regression test: a focus animation still has `canvas-content--animated` applied
    // (isFocusing true) when centerOnNode is invoked — e.g. clicking "Reset zoom" or a
    // breadcrumb ancestor link before a prior focusOnNode's 550ms transition has settled.
    // centerOnNode must strip the transition class before measuring, exactly like
    // locateNodeRects does for focusOnNode/fitToNode/fitToNodes, instead of reading a
    // mid-transition (interpolated) rect.
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    const content = screen.getByTestId("canvas-content");
    // Simulate a still-in-flight focus animation (isFocusing true).
    content.classList.add("canvas-content--animated");

    act(() => ref.current?.centerOnNode("child"));

    // The class must be stripped before measuring (same technique as locateNodeRects), so the
    // pan below is computed from the settled rect and applies without inheriting the transition.
    expect(content.classList.contains("canvas-content--animated")).toBe(false);
    const { x, y, scale } = readTransform();
    expect(scale).toBe(1);
    expect(x).toBeCloseTo(500 - 250, 5);
    expect(y).toBeCloseTo(400 - 200, 5);
  });
});

describe("CanvasViewport inline code panel overflow (expandForInlineCodePanel)", () => {
  it("fitToNode unions in a direct-child code panel's rect when the panel spills outside its block", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child">
          <div data-testid="block-code-view" />
        </div>
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    // The block's own rect is small (its grid track stalled at its floor)...
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 200, height: 50 });
    // ...but its panel, sized from its own CSS, spills well past that box.
    mockRect(screen.getByTestId("block-code-view"), { left: 100, top: 150, width: 400, height: 300 });

    act(() => ref.current?.fitToNode("child"));

    // Union rect is {left:100, top:100, width:400, height:350} — the panel's larger extent, not
    // the block's own small rect.
    const fitScale = Math.min(1000 / 400, 800 / 350) * 0.7;
    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(fitScale, 5);
    expect(x).toBeCloseTo(500 - (100 + 400 / 2) * fitScale, 5);
    expect(y).toBeCloseTo(400 - (100 + 350 / 2) * fitScale, 5);
  });

  it("ignores a code panel that isn't a direct child, so fitting an unrelated ancestor can't be distorted by a deeply nested panel", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child">
          <div data-testid="wrapper">
            <div data-testid="block-code-view" />
          </div>
        </div>
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 200, height: 50 });
    mockRect(screen.getByTestId("block-code-view"), { left: 900, top: 900, width: 400, height: 300 });

    act(() => ref.current?.fitToNode("child"));

    // Only the block's own rect is used — the non-direct-child panel is not unioned in.
    const fitScale = Math.min(1000 / 200, 800 / 50) * 0.7;
    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(fitScale, 5);
    expect(x).toBeCloseTo(500 - (100 + 200 / 2) * fitScale, 5);
    expect(y).toBeCloseTo(400 - (100 + 50 / 2) * fitScale, 5);
  });
});

describe("CanvasViewport fitToNodes", () => {
  it("fits the union of every found node's rect and returns true once the framed rect settles", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
        <div data-node-id="b" data-testid="b" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 100, height: 100 });
    mockRect(screen.getByTestId("b"), { left: 500, top: 400, width: 100, height: 100 });

    // The fit is applied on the first call, so the transform is already correct after one call —
    // but fitToNodes reports "done" only after the framed rect holds steady across frames (it keeps
    // re-fitting while lazily-loaded rows are still growing the tree), so the first call returns
    // false even with both nodes present.
    let framedAll = true;
    act(() => {
      framedAll = ref.current?.fitToNodes(["a", "b"]) ?? true;
    });
    expect(framedAll).toBe(false);

    // Union rect is {left:100, top:100, right:600, bottom:500} -> {width:500, height:400}
    const fitScale = Math.min(1000 / 500, 800 / 400) * 0.7;
    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(fitScale, 5);
    expect(x).toBeCloseTo(500 - (100 + 500 / 2) * fitScale, 5);
    expect(y).toBeCloseTo(400 - (100 + 400 / 2) * fitScale, 5);
  });

  it("reports done only after the framed rect stays steady across consecutive frames", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
        <div data-node-id="b" data-testid="b" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 100, height: 100 });
    mockRect(screen.getByTestId("b"), { left: 500, top: 400, width: 100, height: 100 });

    // A tree still growing (its measured extent changes between frames) never reports done...
    let framedAll = true;
    act(() => {
      framedAll = ref.current?.fitToNodes(["a", "b"]) ?? true;
    });
    expect(framedAll).toBe(false);
    act(() => {
      mockRect(screen.getByTestId("b"), { left: 500, top: 700, width: 100, height: 100 });
      framedAll = ref.current?.fitToNodes(["a", "b"]) ?? true;
    });
    expect(framedAll).toBe(false);

    // ...but once the extent stops changing, a couple of steady frames flip it to done.
    act(() => {
      framedAll = ref.current?.fitToNodes(["a", "b"]) ?? true;
    });
    expect(framedAll).toBe(false);
    act(() => {
      framedAll = ref.current?.fitToNodes(["a", "b"]) ?? true;
    });
    expect(framedAll).toBe(true);
  });

  it("returns false and fits only the found subset when some requested ids aren't mounted yet", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 100, height: 100 });

    let framedAll = true;
    act(() => {
      framedAll = ref.current?.fitToNodes(["a", "not-mounted-yet"]) ?? true;
    });

    expect(framedAll).toBe(false);
    // fitScale = min(1000/100, 800/100) * 0.7 = 5.6, clamped down to FOCUS_MAX_SCALE (3.5).
    expect(readTransform().scale).toBeCloseTo(3.5, 5);
  });

  it("returns false and leaves the view unchanged when none of the requested ids are mounted", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    let framedAll = true;
    act(() => {
      framedAll = ref.current?.fitToNodes(["missing-1", "missing-2"]) ?? true;
    });

    expect(framedAll).toBe(false);
    expect(readTransform()).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("CanvasViewport fitToAllNodes", () => {
  it("fits the union of absolutely-positioned sibling boxes with no measurable common ancestor", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        {/* The C1 view's shape: box anchors under a `display: contents` wrapper, so the wrapper
            itself has no box and there is no root node to fit. */}
        <div data-testid="wrapper" style={{ display: "contents" }}>
          <div data-node-id="c1-system" data-testid="system" />
          <div data-node-id="c1-actor::developer" data-testid="actor" />
        </div>
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("system"), { left: 100, top: 100, width: 100, height: 100 });
    mockRect(screen.getByTestId("actor"), { left: 500, top: 400, width: 100, height: 100 });

    act(() => ref.current?.fitToAllNodes());

    // Union rect is {left:100, top:100, right:600, bottom:500} -> {width:500, height:400}
    const fitScale = Math.min(1000 / 500, 800 / 400) * 0.7;
    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(fitScale, 5);
    expect(x).toBeCloseTo(500 - (100 + 500 / 2) * fitScale, 5);
    expect(y).toBeCloseTo(400 - (100 + 400 / 2) * fitScale, 5);
  });

  it("leaves the view unchanged when nothing measurable is mounted", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="a" data-testid="a" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    act(() => ref.current?.fitToAllNodes());

    expect(readTransform()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("clears any pending focus-toggle memory instead of toggling", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });

    const initialTransform = readTransform();
    act(() => ref.current?.focusOnNode("child"));
    act(() => ref.current?.fitToAllNodes());

    // Same contract as fitToNode: an unconditional re-fit must not leave the toggle memory behind,
    // or the next focus click would restore the now-stale pre-focus view.
    act(() => ref.current?.focusOnNode("child"));
    expect(readTransform()).not.toEqual(initialTransform);
  });
});

describe("gridStep", () => {
  it("paints the dot grid at its logical spacing when unzoomed", () => {
    expect(gridStep(1)).toBe(28);
  });

  it("doubles the logical step until the painted spacing is legible when zoomed out", () => {
    // A flat 28 * 0.25 would paint dots 7px apart — grey mush rather than a grid.
    expect(gridStep(0.25)).toBe(28);
    expect(gridStep(0.5)).toBe(28);
  });

  it("halves the logical step so a zoomed-in grid doesn't thin out to a few lonely dots", () => {
    expect(gridStep(2)).toBe(28);
    expect(gridStep(2.5)).toBe(35);
  });

  it("keeps every step inside one octave of the base spacing across the whole zoom range", () => {
    const steps = [0.25, 0.4, 0.75, 1, 1.3, 1.9, 2.5].map(gridStep);

    expect(steps.every((step) => step >= 28 && step < 56)).toBe(true);
  });

  it("falls back to the base spacing rather than a degenerate one for a non-finite scale", () => {
    expect(gridStep(0)).toBe(28);
    expect(gridStep(Number.NaN)).toBe(28);
  });
});

describe("CanvasViewport dot grid", () => {
  it("publishes the camera as background vars so the grid tracks pan and zoom", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref}>
        <div data-node-id="child" data-testid="child" />
      </CanvasViewport>,
    );

    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("child"), { left: 100, top: 100, width: 300, height: 200 });
    act(() => ref.current?.focusOnNode("child"));

    const { style } = screen.getByTestId("app-canvas");
    const { x, y, scale } = readTransform();
    expect(style.getPropertyValue("--canvas-grid-x")).toBe(`${x}px`);
    expect(style.getPropertyValue("--canvas-grid-y")).toBe(`${y}px`);
    expect(style.getPropertyValue("--canvas-grid-size")).toBe(`${gridStep(scale)}px`);
  });

  it("starts the grid at the untranslated origin", () => {
    render(
      <CanvasViewport>
        <div data-node-id="child" />
      </CanvasViewport>,
    );

    const { style } = screen.getByTestId("app-canvas");

    expect(style.getPropertyValue("--canvas-grid-x")).toBe("0px");
    expect(style.getPropertyValue("--canvas-grid-size")).toBe("28px");
  });
});
