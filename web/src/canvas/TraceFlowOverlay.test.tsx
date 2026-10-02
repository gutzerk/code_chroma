import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TraceFlowOverlay } from "./TraceFlowOverlay";
import { traceStore } from "../state/traceStore";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { expansionStore } from "../state/expansionState";
import type { Trace } from "../state/types";

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
  traceStore.reset();
  canvasLayoutStore.reset();
  expansionStore.reset();
});

const OK_TRACE: Trace = {
  id: "t1",
  entry: "create_order()",
  created_at: "",
  status: "ok",
  steps: [
    { seq: 0, node_id: "function::create_order", event: "call", depth: 0, caller_node_id: null },
    {
      seq: 1,
      node_id: "function::apply_discount",
      event: "call",
      depth: 1,
      caller_node_id: "function::create_order",
    },
  ],
};

const FAILED_TRACE: Trace = {
  id: "t2",
  entry: "charge()",
  created_at: "",
  status: "failed",
  steps: [
    {
      seq: 0,
      node_id: "function::charge",
      event: "raise",
      depth: 0,
      error: { type: "ValueError", message: "declined", handled: false },
    },
  ],
};

/** Renders two blocks carrying data-node-id (each with a .block-header the overlay measures)
 * alongside the overlay, which reads the live DOM rather than props. */
function renderWithBlocks() {
  return render(
    <>
      <div data-node-id="function::create_order">
        <div className="block-header" data-testid="caller" />
      </div>
      <div data-node-id="function::apply_discount">
        <div className="block-header" data-testid="callee" />
      </div>
      <TraceFlowOverlay />
    </>,
  );
}

describe("TraceFlowOverlay", () => {
  it("draws a caller→callee edge and frames the active node for the current step", () => {
    renderWithBlocks();
    traceStore.loadTrace(OK_TRACE);
    act(() => {
      traceStore.stepForward();
    });
    mockRect(screen.getByTestId("caller"), { left: 100, top: 100, width: 200, height: 40 });
    mockRect(screen.getByTestId("callee"), { left: 500, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("trace-flow-overlay");
    const edge = overlay.querySelector("path.trace-flow-edge");
    expect(edge).toHaveAttribute("d", "M 300 120 L 500 120");
    expect(edge).toHaveClass("trace-flow-edge--active");
    const activeFrame = overlay.querySelector("rect.trace-node-frame--active");
    expect(activeFrame).toHaveAttribute("x", "496");
    expect(activeFrame).toHaveAttribute("width", "208");
  });

  it("routes an error edge to its own marker so the arrowhead actually renders red", () => {
    const trace: Trace = {
      id: "t3",
      entry: "charge()",
      created_at: "",
      status: "failed",
      steps: [
        { seq: 0, node_id: "function::create_order", event: "call", depth: 0, caller_node_id: null },
        {
          seq: 1,
          node_id: "function::charge",
          event: "raise",
          depth: 1,
          caller_node_id: "function::create_order",
          error: { type: "ValueError", message: "declined", handled: false },
        },
      ],
    };
    render(
      <>
        <div data-node-id="function::create_order">
          <div className="block-header" data-testid="caller" />
        </div>
        <div data-node-id="function::charge">
          <div className="block-header" data-testid="callee" />
        </div>
        <TraceFlowOverlay />
      </>,
    );
    traceStore.loadTrace(trace);
    act(() => traceStore.stepForward());
    mockRect(screen.getByTestId("caller"), { left: 100, top: 100, width: 200, height: 40 });
    mockRect(screen.getByTestId("callee"), { left: 500, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("trace-flow-overlay");
    const edge = overlay.querySelector("path.trace-flow-edge--error");
    expect(edge).toHaveAttribute("marker-end", "url(#trace-arrow-error)");
    expect(overlay.querySelector("marker#trace-arrow-error path.trace-arrow-head--error")).toBeInTheDocument();
  });

  it("marks the active node red on an error frame", () => {
    render(
      <>
        <div data-node-id="function::charge">
          <div className="block-header" data-testid="culprit" />
        </div>
        <TraceFlowOverlay />
      </>,
    );
    traceStore.loadTrace(FAILED_TRACE);
    mockRect(screen.getByTestId("culprit"), { left: 100, top: 100, width: 200, height: 40 });

    act(() => {
      canvasLayoutStore.bump();
    });

    const overlay = screen.getByTestId("trace-flow-overlay");
    expect(overlay.querySelector("rect.trace-node-frame--error")).toBeInTheDocument();
  });

  it("draws nothing when no trace is loaded", () => {
    render(<TraceFlowOverlay />);

    const overlay = screen.getByTestId("trace-flow-overlay");
    expect(overlay.querySelectorAll("path.trace-flow-edge")).toHaveLength(0);
    expect(overlay.querySelectorAll("rect.trace-node-frame")).toHaveLength(0);
    expect(overlay).toHaveAttribute("role", "img");
    expect(overlay).toHaveAttribute("aria-label", "No trace steps");
  });

  it("announces the count of trace steps currently drawn", () => {
    renderWithBlocks();
    traceStore.loadTrace(OK_TRACE);
    act(() => {
      traceStore.stepForward();
    });
    mockRect(screen.getByTestId("caller"), { left: 100, top: 100, width: 200, height: 40 });
    mockRect(screen.getByTestId("callee"), { left: 500, top: 100, width: 200, height: 40 });

    act(() => {
      fireEvent(window, new Event("resize"));
    });

    const overlay = screen.getByTestId("trace-flow-overlay");
    expect(overlay).toHaveAttribute("aria-label", "2 trace steps");
  });
});
