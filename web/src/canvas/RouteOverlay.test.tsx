import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RouteOverlay } from "./RouteOverlay";
import { routeStore } from "../state/routeStore";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { expansionStore } from "../state/expansionState";
import type { Route } from "./doc/routeStep";

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
  routeStore.reset();
  canvasLayoutStore.reset();
  expansionStore.reset();
});

const step = (id: string, order: number, nodeId: string) => ({ id, order, title: id, kind: "decide" as const, nodeIds: [nodeId], children: [] });
const ROUTE: Route = { id: "r", title: "T", summary: "", steps: [step("a", 1, "file::a"), step("b", 2, "file::b")] };

describe("RouteOverlay", () => {
  it("numbers each step on its file, joins them with a path and fades the rest", () => {
    render(
      <>
        <div data-node-id="file::a"><div className="block-header" data-testid="a" /></div>
        <div data-node-id="file::b"><div className="block-header" data-testid="b" /></div>
        <div data-node-id="file::c" data-testid="c" />
        <RouteOverlay />
      </>,
    );
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 200, height: 40 });
    mockRect(screen.getByTestId("b"), { left: 500, top: 100, width: 200, height: 40 });
    act(() => routeStore.show(ROUTE));
    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("route-overlay");
    expect([...overlay.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["1", "✓"]);
    expect(overlay.querySelector("path.route-overlay-path")).toHaveAttribute("d", "M 300 120 H 500");
    expect(overlay.querySelector("path.route-overlay-path")).toHaveAttribute("marker-end", "url(#route-arrow)");
    expect(screen.getByTestId("c")).toHaveAttribute("data-route-dim");
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-route-dim");
  });

  it("leaves a diagram box that shares a node id alone, so its own diagram draws its chip and arrows", () => {
    render(
      <>
        <div data-node-id="file::a" data-canvas-element><div className="block-header" data-testid="a" /></div>
        <RouteOverlay />
      </>,
    );
    mockRect(screen.getByTestId("a"), { left: 100, top: 100, width: 200, height: 40 });
    act(() => routeStore.show(ROUTE));
    act(() => {
      fireEvent(window, new Event("resize"));
    });

    expect(screen.getByTestId("route-overlay").querySelectorAll("text")).toHaveLength(0);
  });
});
