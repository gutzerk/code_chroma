import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChangeConnectionsOverlay } from "./ChangeConnectionsOverlay";
import { changeCardStore } from "../state/changeCardStore";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { expansionStore } from "../state/expansionState";

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

// jsdom implements neither SVGSVGElement.getScreenCTM nor a matrix-aware DOMPoint, so stub both as
// an identity transform — the overlay's math then passes screen coords straight through, letting us
// assert exact path geometry from the mocked rects.
class IdentityMatrix {
  inverse() {
    return this;
  }
}
class IdentityPoint {
  constructor(
    public x: number,
    public y: number,
  ) {}
  matrixTransform() {
    return this;
  }
}

// Set once for the whole file (not per-test) so the overlay's layout-settle requestAnimationFrame,
// which can fire after a test ends, never lands on a torn-down DOMPoint stub.
const svgProto = SVGSVGElement.prototype as unknown as { getScreenCTM?: () => IdentityMatrix };
let originalGetScreenCTM: typeof svgProto.getScreenCTM;

beforeAll(() => {
  (globalThis as unknown as { DOMPoint: typeof IdentityPoint }).DOMPoint = IdentityPoint;
  originalGetScreenCTM = svgProto.getScreenCTM;
  svgProto.getScreenCTM = () => new IdentityMatrix();
});

afterAll(() => {
  delete (globalThis as unknown as { DOMPoint?: typeof IdentityPoint }).DOMPoint;
  svgProto.getScreenCTM = originalGetScreenCTM;
});

afterEach(() => {
  changeCardStore.reset();
  canvasLayoutStore.reset();
  expansionStore.reset();
});

/** Renders a bare block row + panel fixture next to the overlay, since the overlay reads the live
 * DOM (querySelectorAll("[data-change-node-id]")) rather than props. */
function renderWithChangePanel(status?: string) {
  return render(
    <>
      <div className="block-row">
        <div className="block-header" data-testid="header" />
        <div
          className="change-cards-panel"
          data-change-node-id="function::login"
          data-change-status={status}
          data-testid="panel"
        />
      </div>
      <ChangeConnectionsOverlay />
    </>,
  );
}

describe("ChangeConnectionsOverlay", () => {
  it("frames each block (padded, excluding the panel) and lines from the panel to the frame edge", () => {
    renderWithChangePanel();
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    // Resize is one of the overlay's recompute triggers — fire it after mocking rects.
    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    // Frame = header box padded by 8px: (92, 92) → (308, 148).
    const frame = overlay.querySelector("rect.plan-connection-frame");
    expect(frame).toHaveAttribute("x", "92");
    expect(frame).toHaveAttribute("y", "92");
    expect(frame).toHaveAttribute("width", "216");
    expect(frame).toHaveAttribute("height", "56");

    // Line runs from the panel's left edge (500) to the frame's right edge (308), both at y=120.
    const path = overlay.querySelector("path.plan-connection-path");
    expect(path).toHaveAttribute("d", "M 500 120 L 308 120");
  });

  it("colors by the change panel's own status attribute", () => {
    renderWithChangePanel("delete");
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay.querySelector("rect.plan-connection-frame")).toHaveClass(
      "plan-connection-frame--delete",
    );
    expect(overlay.querySelector("path.plan-connection-path")).toHaveClass(
      "plan-connection-path--delete",
    );
  });

  it("falls back to the change accent when a panel has no status", () => {
    renderWithChangePanel();
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay.querySelector("rect.plan-connection-frame")).toHaveClass(
      "plan-connection-frame--change",
    );
  });

  it("draws nothing when no change panels are in the DOM", () => {
    render(<ChangeConnectionsOverlay />);

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay.querySelectorAll("path")).toHaveLength(0);
    expect(overlay.querySelectorAll("rect")).toHaveLength(0);
    expect(overlay).toHaveAttribute("role", "img");
    expect(overlay).toHaveAttribute("aria-label", "No change cards");
  });

  it("announces the change card count once a panel is framed", () => {
    renderWithChangePanel();
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay).toHaveAttribute("role", "img");
    expect(overlay).toHaveAttribute("aria-label", "1 change card");
  });

  it("recomputes when a change panel drag bumps its own geometry version", () => {
    renderWithChangePanel();
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    act(() => {
      changeCardStore.notifyGeometryChange();
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay.querySelector("path.plan-connection-path")).toHaveAttribute(
      "d",
      "M 500 120 L 308 120",
    );
    expect(overlay.querySelector("rect.plan-connection-frame")).toBeInTheDocument();
  });

  it("recomputes when a block resize bumps the canvas layout version", () => {
    renderWithChangePanel();
    mockRect(screen.getByTestId("panel"), { left: 500, top: 100, width: 300, height: 40 });
    mockRect(screen.getByTestId("header"), { left: 100, top: 100, width: 200, height: 40 });

    // A block resize (e.g. inline code toggle) doesn't touch cards/expandedNodeIds/geometry —
    // only the layout version — yet the frame must still re-measure to the block's new box.
    act(() => {
      canvasLayoutStore.bump();
    });

    const overlay = screen.getByTestId("change-connections-overlay");
    expect(overlay.querySelector("path.plan-connection-path")).toHaveAttribute(
      "d",
      "M 500 120 L 308 120",
    );
    expect(overlay.querySelector("rect.plan-connection-frame")).toBeInTheDocument();
  });
});
