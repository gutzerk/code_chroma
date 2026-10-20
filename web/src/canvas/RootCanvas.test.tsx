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
import { openFilesStore } from "./openFilesStore";
import { layoutStore } from "./layout/layoutStore";
import { inspectorStore } from "./inspectorStore";
import { terminalPanelStore } from "../terminal/terminalPanelStore";
import { collapsedLayersStore } from "./doc/collapsedLayersStore";
import { codeViewModeStore } from "./codeViewModeStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC } from "../state/types";
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

/** A minimal, real (not stubbed) in-memory canvas.json stand-in, starting empty like a fresh repo. */
function makeCanvasState() {
  let doc: CanvasDoc = { ...EMPTY_CANVAS_DOC, doc_id: "d1" };
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
  layoutStore.reset();
  openFilesStore.reset();
  collapsedLayersStore.reset();
  codeViewModeStore.reset();
  inspectorStore.reset();
  terminalPanelStore.reset();
  vi.restoreAllMocks();
});

describe("RootCanvas left panel", () => {
  const openFiles = () => act(() => layoutStore.openLeft("files"));

  it("renders the Files tab with the tree, and the rail toggle collapses to the bar", async () => {
    openFiles();
    renderCanvas();

    await waitFor(() => expect(screen.getByTestId("left-panel-files")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.getByTestId("left-panel-files").querySelectorAll("[data-testid='tree-node']").length,
      ).toBeGreaterThan(0),
    );

    act(() => screen.getByLabelText("Hide diagrams panel").click());
    expect(screen.queryByTestId("left-panel")).toBeNull();
    expect(screen.getByTestId("collapsed-left-bar")).toBeTruthy();
  });

  it("hides the code sidebar while the left panel is closed", () => {
    act(() =>
      openFilesStore.open({
        node_id: "a.py",
        name: "a.py",
        level: "file",
        parent_id: "root",
        has_children: false,
        child_count: 0,
        source: "x = 1",
      }),
    );
    renderCanvas();
    expect(screen.getByTestId("code-sidebar")).not.toHaveAttribute("hidden");

    act(() => layoutStore.closeLeft());

    expect(screen.getByTestId("code-sidebar")).toHaveAttribute("hidden");
  });

  it("hides the tree from the canvas by default", async () => {
    openFiles();
    renderCanvas();

    await waitFor(() => expect(screen.getByTestId("left-panel-files")).toBeTruthy());
    const canvas = screen.getByTestId("canvas-doc-view");
    expect(canvas.querySelectorAll("[data-testid='tree-node']").length).toBe(0);
  });
});

describe("RootCanvas agents panel", () => {
  it("collapses to the bar and restores the rail", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("agent-task-rail")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Collapse agents panel" }));

    expect(screen.queryByTestId("agent-task-rail")).toBeNull();
    expect(screen.getByTestId("agents-collapsed-bar")).toBeTruthy();

    act(() => layoutStore.setAgentsMode("normal"));

    expect(screen.getByTestId("agent-task-rail")).toBeTruthy();
  });

  it("shows the full-screen view and keeps the collapsed left bar", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("agent-task-rail")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Expand agents to full screen" }));

    expect(screen.getByTestId("agent-full-screen")).toBeTruthy();
    expect(screen.getByTestId("collapsed-left-bar")).toBeTruthy();
  });

  it("closes an open inspector when collapsing the panel", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("app-root")).toBeTruthy());
    act(() => inspectorStore.open("function::calculate_total", "calculate_total"));

    fireEvent.click(screen.getByRole("button", { name: "Collapse agents panel" }));

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
