import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanvasDocView } from "./CanvasDocView";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { canvasDocStore } from "./canvasDocStore";
import { collapsedLayersStore } from "./collapsedLayersStore";
import { expansionStore } from "../../state/expansionState";
import { selectionStore } from "../../state/selectionStore";
import {
  IMPACT_CHANGES_STUB,
  EPIC_BRIEF_STUB,
  EPICS_STUB,
  PATTERNS_STUB,
} from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import type {
  CanvasBatch,
  CanvasBatchResult,
  CanvasDoc,
  CanvasEdge,
  CanvasElement,
} from "../../state/types";

function elementOf(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "impact",
    layer: "default",
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

function edgeOf(overrides: Partial<CanvasEdge> & { id: string; from: string; to: string }): CanvasEdge {
  return { label: "", kind: "uses", layer: "default", ...overrides };
}

function docWith(elements: CanvasElement[], edges: CanvasEdge[] = []): CanvasDoc {
  return {
    schema_version: 1,
    doc_id: "d1",
    updated_at: "",
    elements: Object.fromEntries(elements.map((el) => [el.id, el])),
    edges: Object.fromEntries(edges.map((edge) => [edge.id, edge])),
  };
}

function client(
  doc: CanvasDoc,
  overrides: Partial<EngineClient> = {},
): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: (async () => ({}) as never) as EngineClient["getDiagram"],
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" }),
    getDiagramStatus: async () => ({ state: "idle", error: null }),
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    getCanvas: async () => doc,
    patchCanvas: async (): Promise<CanvasBatchResult> => ({
      ok: true,
      batch_id: "b1",
      id_map: {},
      affected: [],
    }),
    subscribeCanvas: () => () => {},
    ...overrides,
  } as EngineClient;
}

afterEach(() => {
  canvasDocStore.reset();
  collapsedLayersStore.reset();
  expansionStore.reset();
  selectionStore.clear();
});

describe("CanvasDocView", () => {
  it("renders a recipe box and a note", async () => {
    const doc = docWith([
      elementOf({ id: "e1", render: "impact", label: "Auth service" }),
      elementOf({ id: "e2", render: "note", label: "remember this" }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Auth service")).toBeInTheDocument());
    expect(screen.getByText("remember this")).toBeInTheDocument();
  });

  it("writes one update_element op when a box is dragged", async () => {
    const doc = docWith([elementOf({ id: "e1", render: "impact", label: "Auth service" })]);
    const patchCanvas = vi.fn(
      async (_batch: CanvasBatch): Promise<CanvasBatchResult> => ({
        ok: true,
        batch_id: "b1",
        id_map: {},
        affected: [],
      }),
    );
    const engineClient = client(doc, { patchCanvas });

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-node-box")).toBeInTheDocument());
    const box = screen.getByTestId("canvas-node-box");
    fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 50, clientY: 30 });

    await waitFor(() => expect(patchCanvas).toHaveBeenCalledTimes(1));
    expect(patchCanvas.mock.calls[0][0].ops).toEqual([
      { op: "update_element", id: "e1", position: { x: 150, y: 130 } },
    ]);
  });

  it("does not double-count the drag offset once it's folded into the box's own position", async () => {
    // Regression: useDragOffset's local `offset` state used to stay pinned at the finished drag's
    // delta forever (never reset), so it kept adding on top of the now-updated persisted position
    // on every render until the page reloaded -- a box (and its arrows, via CanvasEdges) would drift
    // further away with every single drag, only "fixed" by a hard refresh.
    const doc = docWith([elementOf({ id: "e1", render: "impact", label: "Auth service" })]);
    const engineClient = client(doc, { patchCanvas: async () => ({ ok: true, batch_id: "b1", id_map: {}, affected: [] }) });

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-node-box")).toBeInTheDocument());
    const box = screen.getByTestId("canvas-node-box");
    fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 50, clientY: 30 });

    // Element started at (100, 100), box width 300 -> centered left is x - 150.
    // Correct post-drag position is (150, 130); the bug would render at (200, 160) instead.
    expect(box.style.left).toBe("0px");
    expect(box.style.top).toBe("94px");
  });

  it("does not render an edge whose endpoint element no longer exists in the document", async () => {
    const doc = docWith(
      [elementOf({ id: "e1", render: "impact", label: "A" })],
      // "e2" was already deleted (e.g. a partial batch) -- this edge should never have survived it,
      // but rendering it anyway would point an arrow at nothing.
      [edgeOf({ id: "edge1", from: "e1", to: "e2" })],
    );
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByTestId("canvas-doc-relationship")).not.toBeInTheDocument();
  });

  it("keeps rendering an edge whose own layer differs but both boxes stay visible", async () => {
    const doc = docWith(
      [
        elementOf({ id: "e1", render: "impact", label: "A", layer: "shown" }),
        elementOf({ id: "e2", render: "impact", label: "B", layer: "shown", position: { x: 400, y: 100 } }),
      ],
      [edgeOf({ id: "edge1", from: "e1", to: "e2", layer: "shown" })],
    );
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-relationship")).toBeInTheDocument());
  });

  it("hides a collapsed diagram's elements and edges without deleting them from the document", async () => {
    const doc = docWith(
      [
        elementOf({ id: "e1", render: "impact", label: "Hidden box", layer: "c1" }),
        elementOf({ id: "e2", render: "impact", label: "Other box", layer: "c1", position: { x: 400, y: 100 } }),
        elementOf({ id: "e3", render: "impact", label: "Kept box", layer: "patterns" }),
      ],
      [edgeOf({ id: "edge1", from: "e1", to: "e2", layer: "c1" })],
    );
    const engineClient = client(doc);
    collapsedLayersStore.collapse("c1");

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Kept box")).toBeInTheDocument());
    expect(screen.queryByText("Hidden box")).not.toBeInTheDocument();
    expect(screen.queryByText("Other box")).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas-doc-relationship")).not.toBeInTheDocument();
    expect(canvasDocStore.getDoc().elements.e1).toBeDefined();
    expect(canvasDocStore.getDoc().edges.edge1).toBeDefined();
  });

  it("draws nothing for a legacy hierarchy element an old document still carries", async () => {
    const doc = docWith([
      elementOf({ id: "e1", render: "hierarchy", node_id: "root", layer: "hierarchy" }),
      elementOf({ id: "e2", render: "note", label: "still here" }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("still here")).toBeInTheDocument());
    expect(document.querySelector('[data-element-id="e1"]')).toBeNull();
  });

  it("re-shows a diagram's elements the moment it's expanded again, no refetch needed", async () => {
    const doc = docWith([elementOf({ id: "e1", render: "impact", label: "Auth service", layer: "c1" })]);
    const engineClient = client(doc);
    collapsedLayersStore.collapse("c1");

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByText("Auth service")).not.toBeInTheDocument();

    act(() => {
      collapsedLayersStore.expand("c1");
    });

    expect(screen.getByText("Auth service")).toBeInTheDocument();
  });

  it("draws a group's frame around its members, not a box of its own", async () => {
    const doc = docWith([
      elementOf({ id: "g1", render: "group", label: "External integrations" }),
      elementOf({ id: "m1", render: "custom", label: "Member A", group_id: "g1", position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "Member B", group_id: "g1", position: { x: 500, y: 300 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-group-frame")).toBeInTheDocument());
    // A group never gets its own canvas-node-box -- only its members do, and the frame carries the
    // group's label instead, so the name appears exactly once across both.
    expect(screen.getAllByTestId("canvas-node-box")).toHaveLength(2);
    expect(screen.getAllByText("External integrations")).toHaveLength(1);
    const frame = screen.getByTestId("canvas-group-frame");
    expect(frame.style.left).toBe("-82px");
    expect(frame.style.top).toBe("16px");
  });

  it("stops drawing a group's frame once every member's layer is collapsed", async () => {
    const doc = docWith([
      elementOf({ id: "g1", render: "group", label: "External integrations", layer: "c1" }),
      elementOf({ id: "m1", render: "custom", label: "Member A", group_id: "g1", layer: "c1" }),
    ]);
    const engineClient = client(doc);
    collapsedLayersStore.collapse("c1");

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByTestId("canvas-group-frame")).not.toBeInTheDocument();
  });

  it("draws a dashed frame around a whole diagram, labeled with the layer's own recipe name", async () => {
    const doc = docWith([
      elementOf({ id: "e1", render: "c1", label: "Auth service", layer: "c1", position: { x: 100, y: 100 } }),
      elementOf({ id: "e2", render: "c1", label: "Billing", layer: "c1", position: { x: 500, y: 300 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-diagram-frame")).toBeInTheDocument());
    expect(screen.getByText("C1")).toBeInTheDocument();
  });

  it("sizes a diagram's frame off its real boxes, not a group's own stale position field", async () => {
    // Regression: a group's own `position` is never touched again after creation (GroupFrame
    // renders purely off its members' positions) -- but DiagramFrame's whole-layer bounds used to
    // count every element on the layer including the group itself, so a group pinned far from its
    // members stretched the frame out toward that dead spot instead of hugging the real content.
    const doc = docWith([
      elementOf({ id: "g1", render: "group", label: "Stale group", layer: "c1", position: { x: 5000, y: 5000 } }),
      elementOf({ id: "m1", render: "custom", label: "A", layer: "c1", group_id: "g1", position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", layer: "c1", group_id: "g1", position: { x: 300, y: 100 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-diagram-frame")).toBeInTheDocument());
    const frame = screen.getByTestId("canvas-diagram-frame");
    expect(frame.style.left).toBe("-90px");
    expect(frame.style.width).toBe("580px");
  });

  it("sizes off real boxes on ANY diagram layer, not just c1 -- the fix keys off render, not layer name", async () => {
    const doc = docWith([
      elementOf({ id: "g1", render: "group", label: "Stale group", layer: "patterns", position: { x: 5000, y: 5000 } }),
      elementOf({ id: "m1", render: "pattern", label: "A", layer: "patterns", group_id: "g1", position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "pattern", label: "B", layer: "patterns", group_id: "g1", position: { x: 300, y: 100 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-diagram-frame")).toBeInTheDocument());
    const frame = screen.getByTestId("canvas-diagram-frame");
    expect(frame.style.left).toBe("-90px");
    expect(frame.style.width).toBe("580px");
  });

  it("hides a diagram's frame the moment its layer is collapsed", async () => {
    const doc = docWith([
      elementOf({ id: "e1", render: "c1", label: "Auth service", layer: "c1" }),
    ]);
    const engineClient = client(doc);
    collapsedLayersStore.collapse("c1");

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByTestId("canvas-diagram-frame")).not.toBeInTheDocument();
  });

  it("draws a Lane's soft area around boxes sharing a meta.lane value", async () => {
    const doc = docWith([
      elementOf({ id: "m1", render: "custom", label: "A", meta: { lane: "Frontend" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", meta: { lane: "Frontend" }, position: { x: 500, y: 300 } }),
      elementOf({ id: "m3", render: "custom", label: "C" }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-lane-area")).toBeInTheDocument());
    expect(screen.getAllByTestId("canvas-node-box")).toHaveLength(3);
    expect(screen.getByText("Frontend")).toBeInTheDocument();
  });

  it("does not draw a Lane area when no element carries meta.lane", async () => {
    const doc = docWith([elementOf({ id: "e1", render: "impact", label: "A" })]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByTestId("canvas-lane-area")).not.toBeInTheDocument();
  });

  it("draws a Concurrency island around boxes sharing a leading order digit", async () => {
    const doc = docWith([
      elementOf({ id: "m1", render: "custom", label: "A", meta: { order: "2a" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", meta: { order: "2b" }, position: { x: 500, y: 300 } }),
      elementOf({ id: "m3", render: "custom", label: "C", meta: { order: "1" } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-concurrency-island")).toBeInTheDocument());
    // "1" has no other member sharing its leading digit, so it never forms a second island.
    expect(screen.getAllByTestId("canvas-concurrency-island")).toHaveLength(1);
  });

  it("does not draw a Concurrency island for a lone numbered step", async () => {
    const doc = docWith([
      elementOf({ id: "e1", render: "custom", label: "A", meta: { order: "1" } }),
      elementOf({ id: "e2", render: "custom", label: "B", meta: { order: "2" } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-doc-view")).toBeInTheDocument());
    expect(screen.queryByTestId("canvas-concurrency-island")).not.toBeInTheDocument();
  });

  it("merges a zero-padded leading digit into the same island as its plain form", async () => {
    // "02b" and "2a" both parse to the same layout rank (leadingOrderDigits normalizes both to "2")
    // -- they must land in the same island, not two separate ones.
    const doc = docWith([
      elementOf({ id: "m1", render: "custom", label: "A", meta: { order: "2a" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", meta: { order: "02b" }, position: { x: 500, y: 300 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-concurrency-island")).toBeInTheDocument());
    expect(screen.getAllByTestId("canvas-concurrency-island")).toHaveLength(1);
  });

  it("does not merge a Lane shared by boxes in different diagrams into one area", async () => {
    // Two boxes both carrying meta.lane: "Frontend" but on different layers (different diagrams). A
    // single Lane area merging them would bound boxes hundreds of px apart across two diagrams' dashed
    // frames, so the area must stay scoped to its own layer -- exactly two areas, one per diagram.
    const doc = docWith([
      elementOf({ id: "m1", render: "custom", label: "A", layer: "c1", meta: { lane: "Frontend" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", layer: "c1", meta: { lane: "Frontend" }, position: { x: 500, y: 300 } }),
      elementOf({ id: "m3", render: "custom", label: "C", layer: "patterns", meta: { lane: "Frontend" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m4", render: "custom", label: "D", layer: "patterns", meta: { lane: "Frontend" }, position: { x: 500, y: 300 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getAllByTestId("canvas-lane-area")).toHaveLength(2));
  });

  it("does not merge a shared leading order digit across different diagrams into one island", async () => {
    // Regression: a Concurrency island used to bucket on the leading order digit alone, so boxes in
    // two different diagrams both ordering "2a"/"2b" collapsed into a single island bounding boxes
    // from both diagrams at once. It must stay scoped to its own layer -- two islands, one per diagram.
    const doc = docWith([
      elementOf({ id: "m1", render: "custom", label: "A", layer: "c1", meta: { order: "2a" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m2", render: "custom", label: "B", layer: "c1", meta: { order: "2b" }, position: { x: 500, y: 300 } }),
      elementOf({ id: "m3", render: "custom", label: "C", layer: "patterns", meta: { order: "2a" }, position: { x: 100, y: 100 } }),
      elementOf({ id: "m4", render: "custom", label: "D", layer: "patterns", meta: { order: "2b" }, position: { x: 500, y: 300 } }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getAllByTestId("canvas-concurrency-island")).toHaveLength(2));
  });

  it("renders a real group, a Lane, and a Concurrency island together on the same box", async () => {
    const doc = docWith([
      elementOf({ id: "g1", render: "group", label: "Billing" }),
      elementOf({
        id: "m1",
        render: "custom",
        label: "A",
        group_id: "g1",
        meta: { lane: "Backend", order: "2a" },
        position: { x: 100, y: 100 },
      }),
      elementOf({
        id: "m2",
        render: "custom",
        label: "B",
        group_id: "g1",
        meta: { lane: "Backend", order: "2b" },
        position: { x: 500, y: 300 },
      }),
    ]);
    const engineClient = client(doc);

    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <CanvasDocView />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("canvas-group-frame")).toBeInTheDocument());
    expect(screen.getByTestId("canvas-lane-area")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-concurrency-island")).toBeInTheDocument();
  });
});
