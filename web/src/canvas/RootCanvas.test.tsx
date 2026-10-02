import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { RootCanvas } from "./RootCanvas";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import { EPICS_STUB, RESEARCH_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB, diagramStub } from "../engine-client/stubEngineClient";
import { agentStore } from "../agents/agentStore";
import { expansionStore } from "../state/expansionState";
import { diffOverlayStore } from "../state/diffOverlayStore";
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
    ...RESEARCH_STUB,
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
  vi.restoreAllMocks();
});

/** Which renderer draws the hierarchy. `?strategy=` exists so an e2e spec can pin the renderer its
 * assertions are written against, instead of silently inheriting whatever the default happens to
 * be — flipping that default is exactly what broke six specs at once. */
describe("RootCanvas render strategy", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("renders the indented tree, the app's default", async () => {
    renderCanvas();

    await waitFor(() => expect(screen.getByTestId("tree-node")).toBeTruthy());
    expect(screen.queryByTestId("block")).toBeNull();
  });

  it("renders nested boxes instead when the query param pins them", async () => {
    window.history.replaceState({}, "", "/?strategy=boxes");

    renderCanvas();

    await waitFor(() => expect(screen.getByTestId("block")).toBeTruthy());
    expect(screen.queryByTestId("tree-node")).toBeNull();
  });

  it("falls back to the default for an unknown value rather than rendering nothing", async () => {
    window.history.replaceState({}, "", "/?strategy=nonsense");

    renderCanvas();

    await waitFor(() => expect(screen.getByTestId("tree-node")).toBeTruthy());
  });
});

describe("RootCanvas agent launch error", () => {
  it("announces a blocked/failed launch to screen readers, not just visually", async () => {
    renderCanvas();
    await waitFor(() => expect(screen.getByTestId("app-canvas")).toBeTruthy());

    act(() => agentStore.setLaunchError("the limit of 5 concurrent agents is reached"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the limit of 5 concurrent agents is reached",
    );
  });
});
