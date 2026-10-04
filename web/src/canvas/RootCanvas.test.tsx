import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RootCanvas } from "./RootCanvas";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import { EPICS_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB, diagramStub } from "../engine-client/stubEngineClient";
import { agentStore } from "../agents/agentStore";
import { expansionStore } from "../state/expansionState";
import { diffOverlayStore } from "../state/diffOverlayStore";
import { projectTreePanelStore } from "./projectTreePanelStore";
import { inspectorStore } from "./inspectorStore";
import { terminalPanelStore } from "../terminal/terminalPanelStore";
import { collapsedLayersStore } from "./doc/collapsedLayersStore";
import { codeViewModeStore } from "./codeViewModeStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { SEEDED_CANVAS_DOC } from "../state/types";
import type { CanvasBatch, CanvasBatchResult, CanvasDoc, CanvasElement, HierarchyNodeRef } from "../state/types";
import type { TerminalClient } from "../terminal/TerminalClient";

const ROOT: HierarchyNodeRef = {
  node_id: "root",
  name: "repo",
  level: "folder",
  parent_id: null,
  has_children: false,
  child_count: 0,
};

/** A minimal, real (not stubbed) in-memory canvas.json stand-in. It starts seeded with the root
 * block, exactly as the bridge serves it (`canvas/document.py`'s ensure_seeded): nothing on the
 * client creates that element anymore, so an empty document here would render nothing at all. */
function makeCanvasState() {
  let doc: CanvasDoc = { ...SEEDED_CANVAS_DOC, doc_id: "d1" };
  let counter = 0;
  return {
    getCanvas: async (): Promise<CanvasDoc> => doc,
    patchCanvas: async (batch: CanvasBatch): Promise<CanvasBatchResult> => {
      const idMap: Record<string, string> = {};
      const affected: string[] = [];
      const elements = { ...doc.elements };
      for (const op of batch.ops) {
        if (op.op === "add_element") {
          const id = `m${++counter}`;
          elements[id] = {
            id,
            render: (op.render ?? "note") as CanvasElement["render"],
            layer: op.layer ?? "default",
            label: op.label ?? "",
            description: op.description ?? "",
            node_id: op.node_id ?? null,
            position: op.position ?? { x: 0, y: 0 },
            size: op.size ?? null,
            group_id: op.group_id ?? null,
            meta: op.meta ?? {},
            created_by: op.created_by ?? "ai",
          };
          if (op.temp_id) idMap[op.temp_id] = id;
          affected.push(id);
        } else if (op.op === "update_element" && op.id) {
          const real = idMap[op.id] ?? op.id;
          if (elements[real]) {
            elements[real] = {
              ...elements[real],
              ...(op.position ? { position: op.position } : {}),
            };
            affected.push(real);
          }
        }
      }
      doc = { ...doc, elements };
      return { ok: true, batch_id: "b1", id_map: idMap, affected };
    },
    subscribeCanvas: (): (() => void) => () => {},
  };
}

function client(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async () => ROOT,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: diagramStub({}),
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    ...makeCanvasState(),
    runRecipe: async (): Promise<CanvasBatchResult> => ({
      ok: true,
      batch_id: "",
      id_map: {},
      affected: [],
    }),
    ...overrides,
  };
}

/** A terminal client that never opens a socket — the panel only mounts once its button is clicked. */
const TERMINAL_STUB = {
  connect: () => ({ send: () => {}, sendBinary: () => {}, resize: () => {}, close: () => {} }),
} as unknown as TerminalClient;

function renderCanvas(overrides: Partial<EngineClient> = {}) {
  return render(
    <AgentClientProvider client={new MockAgentClient()}>
      <EngineClientProvider repoId="default" client={client(overrides)}>
        <TerminalClientProvider client={TERMINAL_STUB}>
          <RootCanvas />
        </TerminalClientProvider>
      </EngineClientProvider>
    </AgentClientProvider>,
  );
}

afterEach(() => {
  expansionStore.reset();
  diffOverlayStore.clear();
  agentStore.reset();
  projectTreePanelStore.reset();
  collapsedLayersStore.reset();
  codeViewModeStore.reset();
  inspectorStore.reset();
  terminalPanelStore.reset();
  vi.restoreAllMocks();
});

/** How the seeded hierarchy renders once expanded onto the canvas. The boxes-vs-tree *choice* is
 * gone — the hierarchy always renders as nested boxes (`block` inside a `canvas-hierarchy-element`),
 * and the old `?strategy=` param no longer selects anything (see `strategies/types.ts`). */
describe("RootCanvas render strategy", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  // The seeded hierarchy layer on the canvas is collapsed by default; these tests expand it back
  // onto the canvas, then assert the nested-box renderer that draws it.
  const showCanvasTree = () => act(() => collapsedLayersStore.expand("hierarchy"));

  it("renders the hierarchy on the canvas as nested boxes by default", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("app-root")).toBeTruthy());
    showCanvasTree();

    await waitFor(() => expect(screen.getByTestId("canvas-hierarchy-element")).toBeTruthy());
    expect(screen.getByTestId("block")).toBeTruthy();
  });

  it("ignores the legacy ?strategy= param and still renders nested boxes", async () => {
    window.history.replaceState({}, "", "/?strategy=boxes");

    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("app-root")).toBeTruthy());
    showCanvasTree();

    await waitFor(() => expect(screen.getByTestId("canvas-hierarchy-element")).toBeTruthy());
    expect(screen.getByTestId("block")).toBeTruthy();
  });
});

describe("RootCanvas project tree panel", () => {
  // The singleton starts open by default in production (PanelStore(true)); afterEach resets it to
  // closed, so each test re-opens it to model a fresh load before rendering.
  const openPanel = () => act(() => projectTreePanelStore.open());

  it("renders the open panel with the tree, and its rail toggle closes it", async () => {
    openPanel();
    renderCanvas();

    // The open project-tree panel holds the tree.
    await waitFor(() => expect(screen.getByTestId("project-tree-panel")).toBeTruthy());
    expect(
      screen.getByTestId("project-tree-panel").querySelectorAll("[data-testid='tree-node']").length,
    ).toBeGreaterThan(0);

    // Its rail toggle closes it (latched mount keeps it in the DOM, hidden).
    const toggle = screen.getByLabelText("Close project tree panel");
    act(() => toggle.click());
    expect(screen.getByTestId("project-tree-panel").closest("[hidden]")).not.toBeNull();
  });

  it("renders the hierarchy root inside the panel", async () => {
    openPanel();
    renderCanvas({ getNode: async () => ROOT });

    const panel = await screen.findByTestId("project-tree-panel");
    waitFor(() => expect(panel.textContent).toContain("repo"));
  });

  it("hides the tree from the canvas by default", async () => {
    openPanel();
    renderCanvas();

    // The canvas shows no tree rows -- the seeded hierarchy layer is collapsed at load.
    await waitFor(() => expect(screen.getByTestId("project-tree-panel")).toBeTruthy());
    const canvas = screen.getByTestId("canvas-doc-view");
    expect(canvas.querySelectorAll("[data-testid='tree-node']").length).toBe(0);
  });
});

describe("RootCanvas agents and diagrams panel", () => {
  it("collapses and restores the panel without resetting its selected section", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("agent-task-rail")).toBeTruthy());

    fireEvent.click(screen.getByTestId("agent-task-rail-tab-agents"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse agents and diagrams panel" }));

    const panel = screen.getByTestId("agent-task-rail");
    expect(panel).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Expand agents and diagrams panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand agents and diagrams panel" }));

    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("agent-task-rail-tab-agents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("closes an open code popup when collapsing the panel", async () => {
    const calculateTotal: HierarchyNodeRef = {
      node_id: "function::calculate_total",
      name: "calculate_total",
      level: "function",
      parent_id: null,
      has_children: false,
      child_count: 0,
      source: "return 1",
      language: "python",
    };
    renderCanvas({
      getNode: async () => calculateTotal,
      getCanvas: async () => ({
        ...SEEDED_CANVAS_DOC,
        doc_id: "d1",
        elements: {
          calculateTotal: {
            id: "calculateTotal",
            render: "hierarchy",
            layer: "hierarchy",
            label: "",
            description: "",
            node_id: calculateTotal.node_id,
            position: { x: 0, y: 0 },
            size: null,
            group_id: null,
            meta: {},
            created_by: "user",
          },
        },
      }),
    });
    act(() => codeViewModeStore.setMode("popup"));
    await waitFor(() => expect(screen.getByTestId("app-root")).toBeTruthy());
    act(() => collapsedLayersStore.expand("hierarchy"));

    fireEvent.click(
      await screen.findByRole("button", { name: "Show code for calculate_total" }),
    );
    expect(await screen.findByTestId("code-popup")).toBeInTheDocument();
    act(() => inspectorStore.open("function::calculate_total", "calculate_total"));

    fireEvent.click(screen.getByRole("button", { name: "Collapse agents and diagrams panel" }));

    expect(screen.queryByTestId("code-popup")).not.toBeInTheDocument();
    expect(inspectorStore.getIsOpen()).toBe(false);
  });
});

describe("RootCanvas agent launch error", () => {
  it("does not show an agent launch error in the app shell or open its terminal", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("app-canvas")).toBeTruthy());

    act(() => agentStore.setLaunchError("the limit of 5 concurrent agents is reached"));

    expect(terminalPanelStore.getIsOpen()).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
