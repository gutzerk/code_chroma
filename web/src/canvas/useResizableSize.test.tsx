import { describe, expect, it } from "vitest";
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useResizableSize, type ResizableOptions } from "./useResizableSize";

/** A minimal panel exposing the resolved size, so a test can drive the handle and read the result. */
function Panel({ options }: { options: ResizableOptions }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { size, handleProps } = useResizableSize(panelRef, options);

  return (
    <div ref={panelRef} data-testid="panel">
      <div
        data-testid="handle"
        data-width={size?.width ?? ""}
        data-height={size?.height ?? ""}
        {...handleProps}
      />
    </div>
  );
}

/** jsdom does no layout, so the panel's starting size has to be stated rather than measured — the
 * hook reads it from getBoundingClientRect on the first drag. */
function startSize(width: number, height: number) {
  screen.getByTestId("panel").getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  const handle = screen.getByTestId("handle");
  handle.setPointerCapture = () => {};
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
  return {
    width: Number(handle.dataset.width),
    height: Number(handle.dataset.height),
  };
}

describe("useResizableSize", () => {
  it("grows a bottom-anchored panel upward from its top edge", () => {
    render(<Panel options={{ axis: "y", edge: "top", minHeight: 160 }} />);
    startSize(900, 280);

    const size = drag({ x: 600, y: 600 }, { x: 600, y: 500 });

    expect(size.height).toBe(380);
  });

  it("leaves the width alone on a height-only handle", () => {
    render(<Panel options={{ axis: "y", edge: "top", minHeight: 160 }} />);
    startSize(900, 280);

    const size = drag({ x: 600, y: 600 }, { x: 200, y: 500 });

    expect(size.width).toBe(900);
  });

  it("clamps a height-only handle to the caller's fraction of the viewport", () => {
    window.innerHeight = 720;
    render(<Panel options={{ axis: "y", edge: "top", minHeight: 160, maxViewportFraction: 0.6 }} />);
    startSize(900, 280);

    const size = drag({ x: 600, y: 700 }, { x: 600, y: 0 });

    expect(size.height).toBe(432);
  });

  it("never shrinks a height-only handle below its minimum", () => {
    render(<Panel options={{ axis: "y", edge: "top", minHeight: 160 }} />);
    startSize(900, 280);

    const size = drag({ x: 600, y: 400 }, { x: 600, y: 900 });

    expect(size.height).toBe(160);
  });

  it("still grows a right-anchored panel leftward from its left edge", () => {
    render(<Panel options={{ axis: "x", edge: "left", minWidth: 320 }} />);
    startSize(400, 700);

    const size = drag({ x: 900, y: 300 }, { x: 800, y: 300 });

    expect(size.width).toBe(500);
  });

  it("clamps a width-only handle to the caller's fraction of the viewport", () => {
    window.innerWidth = 1280;
    render(<Panel options={{ axis: "x", edge: "left", minWidth: 320, maxViewportFraction: 0.5 }} />);
    startSize(400, 700);

    const size = drag({ x: 1200, y: 300 }, { x: 0, y: 300 });

    expect(size.width).toBe(640);
  });
});
