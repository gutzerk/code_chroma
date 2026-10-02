import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ConnectionsOverlay } from "./ConnectionsOverlay";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import type { Connection } from "../state/types";
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
});

function stubClient(connectionsByNode: Record<string, Connection[]>): EngineClient {
  return {
    getConnections: async (nodeId: string) => connectionsByNode[nodeId] ?? [],
  } as unknown as EngineClient;
}

/** Renders two node boxes the overlay measures, plus the overlay itself (which reads the live DOM
 * via querySelectorAll("[data-node-id]")). */
function renderWithNodes(client: EngineClient) {
  return render(
    <EngineClientProvider repoId="test" client={client}>
      <div data-node-id="a" data-testid="node-a" />
      <div data-node-id="b" data-testid="node-b" />
      <ConnectionsOverlay />
    </EngineClientProvider>,
  );
}

describe("ConnectionsOverlay", () => {
  it("announces an empty label when there are no connections", () => {
    render(
      <EngineClientProvider repoId="test" client={stubClient({})}>
        <ConnectionsOverlay />
      </EngineClientProvider>,
    );

    const overlay = screen.getByTestId("connections-overlay");
    expect(overlay).toHaveAttribute("role", "img");
    expect(overlay).toHaveAttribute("aria-label", "No connections");
  });

  it("announces the connection count once paths resolve", async () => {
    const client = stubClient({ a: [{ from_id: "a", to_id: "b" }] as Connection[], b: [] });
    renderWithNodes(client);
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 40 });

    const overlay = screen.getByTestId("connections-overlay");
    await waitFor(() =>
      expect(overlay).toHaveAttribute("aria-label", "1 connection between nodes"),
    );
  });

  it("recomputes a line when a block resize bumps the canvas layout version", async () => {
    const client = stubClient({ a: [{ from_id: "a", to_id: "b" }] as Connection[], b: [] });
    renderWithNodes(client);
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 40 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 40 });

    const overlay = screen.getByTestId("connections-overlay");
    // Connections load async; once resolved the line runs between the two boxes' facing sides.
    await waitFor(() =>
      expect(overlay.querySelector("path.connection-path")).toHaveAttribute("d", "M 100 20 L 200 20"),
    );

    // Move node-b (as a resize/reflow would) and bump only the layout version — no expand/collapse.
    mockRect(screen.getByTestId("node-b"), { left: 400, top: 0, width: 100, height: 40 });
    act(() => {
      canvasLayoutStore.bump();
    });

    expect(overlay.querySelector("path.connection-path")).toHaveAttribute("d", "M 100 20 L 400 20");
  });

  it("draws the two directions of a pair as two separate lines", async () => {
    const client = stubClient({
      a: [{ from_id: "a", to_id: "b" }] as Connection[],
      b: [{ from_id: "b", to_id: "a" }] as Connection[],
    });
    renderWithNodes(client);
    mockRect(screen.getByTestId("node-a"), { left: 0, top: 0, width: 100, height: 60 });
    mockRect(screen.getByTestId("node-b"), { left: 200, top: 0, width: 100, height: 60 });

    const overlay = screen.getByTestId("connections-overlay");
    await waitFor(() => expect(overlay.querySelectorAll("path.connection-path")).toHaveLength(2));

    const paths = [...overlay.querySelectorAll("path.connection-path")].map((path) =>
      path.getAttribute("d"),
    );
    expect(new Set(paths).size).toBe(2);
  });
});
