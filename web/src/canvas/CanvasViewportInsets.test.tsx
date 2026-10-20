import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { CanvasViewport, type CanvasViewportHandle } from "./CanvasViewport";
import { clearSavedCameraView } from "./canvasCameraStore";

afterEach(() => clearSavedCameraView());

function mockRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}

function readTransform() {
  const style = screen.getByTestId("canvas-content").style.transform;
  const m = style.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  if (!m) throw new Error(`unexpected transform: ${style}`);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

const INSETS = { left: 200, right: 200, bottom: 200 };

describe("CanvasViewport insets", () => {
  it("fits a node into the stage rect minus the insets", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(
      <CanvasViewport ref={ref} insets={INSETS}>
        <div data-node-id="n" data-testid="n" />
      </CanvasViewport>,
    );
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });
    mockRect(screen.getByTestId("n"), { left: 350, top: 250, width: 300, height: 300 });

    act(() => ref.current?.fitToNode("n"));

    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(1.4, 5);
    expect(x).toBeCloseTo(-200, 5);
    expect(y).toBeCloseTo(-260, 5);
  });

  it("fitToBounds centres a world rect in the visible rect", () => {
    const ref = createRef<CanvasViewportHandle>();
    render(<CanvasViewport ref={ref} insets={INSETS}>{null}</CanvasViewport>);
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    act(() => ref.current?.fitToBounds({ x: 0, y: 0, width: 600, height: 300 }));

    const { x, y, scale } = readTransform();
    expect(scale).toBeCloseTo(0.9, 5);
    expect(x).toBeCloseTo(230, 5);
    expect(y).toBeCloseTo(165, 5);
  });

  it("reports view changes", () => {
    const ref = createRef<CanvasViewportHandle>();
    const onViewChange = vi.fn();
    render(<CanvasViewport ref={ref} onViewChange={onViewChange}>{null}</CanvasViewport>);
    mockRect(screen.getByTestId("app-canvas"), { left: 0, top: 0, width: 1000, height: 800 });

    act(() => ref.current?.fitToBounds({ x: 0, y: 0, width: 500, height: 400 }));

    expect(onViewChange).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 1.8 }));
  });
});
