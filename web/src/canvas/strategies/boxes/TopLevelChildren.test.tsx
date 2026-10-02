import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { gridLayout, TopLevelChildren } from "./TopLevelChildren";
import { EngineClientProvider } from "../../../engine-client/EngineClientContext";
import { collisionStore } from "../../collision/collisionStore";
import { selectionStore } from "../../../state/selectionStore";
import type { EngineClient } from "../../../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../../../state/types";
import { NODE_SEP, RANK_SEP } from "../../collision/constants";
import { BLOCK_LAYOUT } from "./layoutConfig";

function node(id: string, name: string): HierarchyNodeRef {
  return {
    node_id: id,
    name,
    level: "folder",
    parent_id: "root",
    has_children: false,
    child_count: 0,
  };
}

describe("gridLayout", () => {
  it("places a single node at the origin", () => {
    const boxes = gridLayout([node("a", "A")], new Map());

    expect(boxes).toEqual([
      { id: "a", x: 0, y: 0, width: BLOCK_LAYOUT.minWidth, height: BLOCK_LAYOUT.minHeight },
    ]);
  });

  it("wraps into a new row once the column count is reached", () => {
    // sqrt(4) = 2 columns, so a 2x2 grid.
    const nodes = ["a", "b", "c", "d"].map((id) => node(id, id));

    const boxes = gridLayout(nodes, new Map());

    expect(boxes[0]).toMatchObject({ id: "a", x: 0, y: 0 });
    expect(boxes[1]).toMatchObject({ id: "b", x: BLOCK_LAYOUT.minWidth + NODE_SEP, y: 0 });
    expect(boxes[2]).toMatchObject({ id: "c", x: 0, y: BLOCK_LAYOUT.minHeight + RANK_SEP });
    expect(boxes[3]).toMatchObject({
      id: "d",
      x: BLOCK_LAYOUT.minWidth + NODE_SEP,
      y: BLOCK_LAYOUT.minHeight + RANK_SEP,
    });
  });

  it("uses a node's measured size over the default when present", () => {
    const sizes = new Map([["a", { width: 300, height: 100 }]]);

    const boxes = gridLayout([node("a", "A"), node("b", "B")], sizes);

    expect(boxes[0]).toMatchObject({ width: 300, height: 100 });
    expect(boxes[1]).toMatchObject({ x: 300 + NODE_SEP });
  });
});

function clientReturning(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    getChangeCards: async () => ({
      base: "HEAD",
      base_resolved: true,
      card_count: 0,
      cards: [],
      by_node: {},
      by_node_status: {},
      unassigned: [],
    }),
    acceptDiff: async () => {},
    getDiagram: (async () => ({}) as never) as EngineClient["getDiagram"],
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    subscribeDiagram: () => () => {},
    generateDiagram: async () => ({ state: "idle" }),
    getDiagramStatus: async () => ({ state: "idle", error: null }),
    subscribeDiagramStatus: () => () => {},
    getDiagramOutput: async () => [],
    subscribeDiagramOutput: () => () => {},
    getSidecar: (async () => ({
      fingerprint: "",
      reviewed_fingerprint: null,
      has_review: false,
      stale: false,
      summary: "",
      blocks: [],
      ghosts: [],
      relationships: [],
      unassigned: [],
      changed_file_count: 0,
      general_pr_comments: [],
    })) as EngineClient["getSidecar"],
    subscribeSidecar: () => () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    ...overrides,
  } as EngineClient;
}

afterEach(() => {
  collisionStore.reset();
  selectionStore.clear();
  vi.restoreAllMocks();
});

function mockRect(element: HTMLElement, x: number, y: number, width: number, height: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
}

function boxOf(nodeId: string): HTMLElement {
  return document.querySelector(`[data-node-id="${nodeId}"]`)?.closest(
    '[data-testid="hierarchy-top-box"]',
  ) as HTMLElement;
}

async function renderPlacedBoxes(client: EngineClient) {
  render(
    <div className="canvas-content">
      <EngineClientProvider repoId="default" client={client}>
        <TopLevelChildren nodes={[node("a", "A"), node("b", "B")]} />
      </EngineClientProvider>
    </div>,
  );
  await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
  mockRect(boxOf("a"), 0, 0, 240, 64);
  mockRect(boxOf("b"), 0, 90, 240, 64);
}

function drag(element: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: 10 + dx, clientY: 10 + dy });
  fireEvent.pointerUp(element, { pointerId: 1, clientX: 10 + dx, clientY: 10 + dy });
}

describe("TopLevelChildren", () => {
  it("renders each node as its own draggable box", async () => {
    await renderPlacedBoxes(clientReturning());

    expect(screen.getAllByTestId("hierarchy-top-box")).toHaveLength(2);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("persists a solo drag under the hierarchy layout kind", async () => {
    const saveDiagramLayout = vi.fn(async () => {});
    await renderPlacedBoxes(clientReturning({ saveDiagramLayout }));

    // Far enough right that it can't collide with "b" (mocked at y 90-154).
    drag(boxOf("a"), 800, 0);

    await waitFor(() =>
      expect(saveDiagramLayout).toHaveBeenCalledWith("hierarchy", { a: { x: 800, y: 0 } }),
    );
  });

  it("moves every selected box together, with no collision settling", async () => {
    const saveDiagramLayout = vi.fn(async () => {});
    await renderPlacedBoxes(clientReturning({ saveDiagramLayout }));
    act(() => selectionStore.replace(["a", "b"]));

    // 200px down would land "a" on top of "b" under solo collision avoidance — a group drag skips
    // that entirely, so both boxes land exactly where released, uncorrected.
    drag(boxOf("a"), 0, 200);

    await waitFor(() =>
      expect(saveDiagramLayout).toHaveBeenCalledWith("hierarchy", {
        a: { x: 0, y: 200 },
        b: { x: 0, y: 200 },
      }),
    );
  });

  it("visually moves the passive (non-dragged) selected box too, not just the one under the pointer", async () => {
    await renderPlacedBoxes(clientReturning());
    act(() => selectionStore.replace(["a", "b"]));
    const b = boxOf("b");
    const initialTop = parseFloat(b.style.top);

    // Only "a" gets real pointer events — "b" is a passive group member and must still pick up
    // the same delta, or it stays frozen while the arrows move to its new position.
    fireEvent.pointerDown(boxOf("a"), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(boxOf("a"), { pointerId: 1, clientX: 10, clientY: 260 });
    // The preview is rAF-throttled, so the mid-drag update needs a frame to flush.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    expect(parseFloat(b.style.top)).toBe(initialTop + 250);
  });
});
