import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { RouteProbeOverlay } from "./RouteProbeOverlay";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { expansionStore } from "../state/expansionState";
import { routeProbeStore } from "../state/routeProbeStore";

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
// an identity transform — the overlay's math then passes screen coords straight through.
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
  canvasLayoutStore.reset();
  expansionStore.reset();
  routeProbeStore.reset();
});

function renderWithNodes() {
  return render(
    <>
      <div data-node-id="a" data-testid="node-a" />
      <div data-node-id="b" data-testid="node-b" />
      <div data-node-id="c" data-testid="node-c" />
      <RouteProbeOverlay />
    </>,
  );
}

describe("RouteProbeOverlay", () => {
  it("announces no route and renders nothing before a probe resolves", () => {
    renderWithNodes();

    const overlay = screen.getByTestId("route-probe-overlay");
    expect(overlay).toHaveAttribute("role", "img");
    expect(overlay).toHaveAttribute("aria-label", "No route");
    expect(overlay.querySelector("path.route-probe-edge")).toBeNull();
  });

  it("draws a segment for a two-node path", async () => {
    renderWithNodes();
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 40 });

    await act(async () => {
      routeProbeStore.probe("a", "b", async () => ["a", "b"]);
      await Promise.resolve();
    });

    const overlay = screen.getByTestId("route-probe-overlay");
    await waitFor(() =>
      expect(overlay.querySelector("path.route-probe-edge")).toHaveAttribute("d", "M 100 20 L 200 20"),
    );
  });

  it("draws two segments for a three-node path", async () => {
    renderWithNodes();
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-c"), { left: 400, top: 0, width: 100, height: 40 });

    await act(async () => {
      routeProbeStore.probe("a", "c", async () => ["a", "b", "c"]);
      await Promise.resolve();
    });

    const overlay = screen.getByTestId("route-probe-overlay");
    await waitFor(() => expect(overlay.querySelectorAll("path.route-probe-edge")).toHaveLength(2));
  });

  it("renders nothing once a probe resolves to no path", async () => {
    renderWithNodes();
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 40 });

    await act(async () => {
      routeProbeStore.probe("a", "b", async () => null);
      await Promise.resolve();
    });

    const overlay = screen.getByTestId("route-probe-overlay");
    await waitFor(() => expect(overlay).toHaveAttribute("aria-label", "No route"));
    expect(overlay.querySelector("path.route-probe-edge")).toBeNull();
  });
});
