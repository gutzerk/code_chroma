import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";
import { inspectorStore } from "./inspectorStore";
import { diffOverlayStore } from "../state/diffOverlayStore";
import { liveStore } from "../state/liveStore";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { EPICS_STUB, RESEARCH_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB, diagramStub } from "../engine-client/stubEngineClient";
import type { EngineClient } from "../engine-client/EngineClient";
import type { Diagram, FunctionDiff, HierarchyNodeRef } from "../state/types";

const EMPTY_C1: Diagram = { nodes: [], relations: [] };

const GRAPH_DIR: HierarchyNodeRef = {
  node_id: "dir::src/graph",
  name: "graph",
  level: "folder",
  parent_id: "dir::src",
  has_children: true,
  child_count: 1,
};

const BUILDER_FILE: HierarchyNodeRef = {
  node_id: "component::src/graph/builder.py",
  name: "builder.py",
  level: "file",
  parent_id: "dir::src/graph",
  has_children: false,
  child_count: 0,
  language: "python",
  source: "def build():\n    return dir_tree()\n",
};

const BUILDER_DIFF: FunctionDiff = {
  node_id: "component::src/graph/builder.py",
  name: "builder.py",
  status: "modified",
  level: "file",
  original_source: "def build():\n    return cluster()\n",
  proposed_source: "def build():\n    return dir_tree()\n",
};

const LOGGING_NEW: HierarchyNodeRef = {
  node_id: "logging::New",
  name: "New",
  level: "function",
  parent_id: "component::src/logging/logging.go",
  has_children: false,
  child_count: 0,
  language: "go",
  source: "func New(serviceName string, level slog.Level) *slog.Logger {\n",
};

const LOGGING_LOGGER: HierarchyNodeRef = {
  node_id: "logging::newLogger",
  name: "newLogger",
  level: "function",
  parent_id: "component::src/logging/logging.go",
  has_children: false,
  child_count: 0,
  language: "go",
  source: "func newLogger(w io.Writer, serviceName string, level slog.Level) *slog.Logger {\n",
};

const NODES: Record<string, HierarchyNodeRef> = {
  [GRAPH_DIR.node_id]: GRAPH_DIR,
  [BUILDER_FILE.node_id]: BUILDER_FILE,
  [LOGGING_NEW.node_id]: LOGGING_NEW,
  [LOGGING_LOGGER.node_id]: LOGGING_LOGGER,
};

function client(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async (nodeId: string) => NODES[nodeId] ?? null,
    getChildren: async (nodeId: string) => (nodeId === GRAPH_DIR.node_id ? [BUILDER_FILE] : []),
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: diagramStub({ c1: EMPTY_C1 }),
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" as const }),
    getDiagramStatus: async () => ({ state: "idle" as const }),
    listTraces: async () => [],
    getTrace: async () => ({
      id: "",
      entry: "",
      created_at: "",
      status: "ok" as const,
      steps: [],
    }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    ...overrides,
  };
}

function renderPanel(engineClient: EngineClient = client()) {
  return render(
    <EngineClientProvider repoId="default" client={engineClient}>
      <InspectorPanel />
    </EngineClientProvider>,
  );
}

afterEach(() => {
  inspectorStore.reset();
  diffOverlayStore.reset();
  liveStore.reset();
});

describe("InspectorPanel", () => {
  it("lists the opened node's children with no back button at the root", async () => {
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));

    renderPanel();

    await waitFor(() => expect(screen.getByText("builder.py")).toBeInTheDocument());
    expect(screen.getByTestId("inspector-panel-title")).toHaveTextContent("Graph model");
    expect(screen.queryByLabelText("Back to the previous level")).not.toBeInTheDocument();
  });

  it("drills into a clicked row and shows its source", async () => {
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("builder.py")).toBeInTheDocument());

    fireEvent.click(screen.getByText("builder.py"));

    await waitFor(() => expect(screen.getByText("dir_tree")).toBeInTheDocument());
  });

  it("returns one level when the back arrow is pressed", async () => {
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("builder.py")).toBeInTheDocument());
    fireEvent.click(screen.getByText("builder.py"));
    await waitFor(() =>
      expect(screen.getByTestId("inspector-panel-title")).toHaveTextContent("builder.py"),
    );

    fireEvent.click(screen.getByLabelText("Back to the previous level"));

    await waitFor(() =>
      expect(screen.getByTestId("inspector-panel-title")).toHaveTextContent("Graph model"),
    );
  });

  it("renders the diff instead of plain source when the node has one", async () => {
    act(() => {
      diffOverlayStore.setDiffs([BUILDER_DIFF]);
      inspectorStore.open(BUILDER_FILE.node_id, "builder.py");
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText("cluster")).toBeInTheDocument());
  });

  it("closes from the header", async () => {
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("builder.py")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Close the code inspector"));

    expect(inspectorStore.getIsOpen()).toBe(false);
  });

  it("notes an empty block rather than rendering a blank body", async () => {
    const empty: HierarchyNodeRef = {
      node_id: "c1-sub::system/ghost",
      name: "Ghost",
      level: "folder",
      parent_id: null,
      has_children: false,
      child_count: 0,
      description: "Removed by this change.",
    };
    act(() => inspectorStore.open(empty.node_id, "Ghost"));

    renderPanel(client({ getNode: async () => empty }));

    await waitFor(() => expect(screen.getByText("Removed by this change.")).toBeInTheDocument());
  });

  it("renders a non-drillable row as a disabled button", async () => {
    const leaf: HierarchyNodeRef = {
      node_id: "dir::src/empty",
      name: "empty",
      level: "folder",
      parent_id: GRAPH_DIR.node_id,
      has_children: false,
      child_count: 0,
    };
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));

    renderPanel(client({ getChildren: async () => [leaf] }));

    await waitFor(() => expect(screen.getByTestId("inspector-row")).toBeDisabled());
  });

  it("re-fetches the current node when the bridge reports a live change", async () => {
    const seen: string[] = [];
    act(() => inspectorStore.open(BUILDER_FILE.node_id, "builder.py"));
    renderPanel(
      client({
        getNode: async (nodeId: string) => {
          seen.push(nodeId);
          return NODES[nodeId] ?? null;
        },
      }),
    );
    await waitFor(() => expect(seen).toHaveLength(1));

    act(() => liveStore.bump());

    await waitFor(() => expect(seen).toHaveLength(2));
  });

  it("keeps a file's classes reachable behind a Show File toggle, not hidden by its source", async () => {
    const fileWithBoth: HierarchyNodeRef = {
      ...BUILDER_FILE,
      has_children: true,
      child_count: 1,
    };
    const cls: HierarchyNodeRef = {
      node_id: "class::GraphBuilder",
      name: "GraphBuilder",
      level: "class",
      parent_id: fileWithBoth.node_id,
      has_children: false,
      child_count: 0,
    };
    act(() => inspectorStore.open(fileWithBoth.node_id, "builder.py"));
    renderPanel(
      client({ getNode: async () => fileWithBoth, getChildren: async () => [cls] }),
    );
    await waitFor(() => expect(screen.getByText("GraphBuilder")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Show File"));

    await waitFor(() => expect(screen.getByText("dir_tree")).toBeInTheDocument());
    expect(screen.queryByText("GraphBuilder")).not.toBeInTheDocument();
  });

  it("opens a leaf straight on its source, with no toggle to press", async () => {
    act(() => inspectorStore.open(BUILDER_FILE.node_id, "builder.py"));

    renderPanel();

    await waitFor(() => expect(screen.getByText("dir_tree")).toBeInTheDocument());
    expect(screen.queryByText("Show File")).not.toBeInTheDocument();
  });

  it("renders a tab per node for a multi-node open and swaps the shown source", async () => {
    act(() => inspectorStore.openMany(["logging::New", "logging::newLogger"], "Logging System"));

    renderPanel();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByTestId("inspector-panel-title")).toHaveTextContent("Logging System");
    // Active tab (first) shows New's source.
    expect(screen.getByTestId("block-code-view-source")).toHaveTextContent(/func New\(/);

    fireEvent.click(screen.getByText("newLogger"));

    await waitFor(() =>
      expect(screen.getByTestId("block-code-view-source")).toHaveTextContent(/func newLogger\(/),
    );
    expect(screen.getByTestId("block-code-view-source")).not.toHaveTextContent(/func New\(/);
  });

  it("keeps the tab row and title inside a single drill level (no back button)", async () => {
    act(() => inspectorStore.openMany(["logging::New", "logging::newLogger"], "Logging System"));

    renderPanel();

    await screen.findAllByRole("tab");
    expect(screen.queryByLabelText("Back to the previous level")).not.toBeInTheDocument();
    // Two tabs render as one level, so closing is a single action.
    fireEvent.click(screen.getByLabelText("Close the code inspector"));
    expect(inspectorStore.getIsOpen()).toBe(false);
  });

  it("uses ids the canvas overlays cannot mistake for a canvas block", async () => {
    act(() => inspectorStore.open(GRAPH_DIR.node_id, "Graph model"));

    renderPanel();

    await waitFor(() => expect(screen.getByText("builder.py")).toBeInTheDocument());
    expect(document.querySelector(`[data-node-id="${BUILDER_FILE.node_id}"]`)).toBeNull();
  });

  it("shows a retryable error instead of staying stuck on Loading when the fetch rejects", async () => {
    act(() => inspectorStore.open(BUILDER_FILE.node_id, "builder.py"));
    let attempts = 0;
    renderPanel(
      client({
        getNode: async (nodeId: string) => {
          attempts += 1;
          if (attempts === 1) throw new Error("bridge unreachable");
          return NODES[nodeId] ?? null;
        },
      }),
    );

    await waitFor(() => expect(screen.getByTestId("inspector-panel-error")).toBeInTheDocument());
    expect(screen.getByText("Failed to load: bridge unreachable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("dir_tree")).toBeInTheDocument());
  });

  it("shows a not-found error instead of staying stuck on Loading when getNode resolves null", async () => {
    act(() => inspectorStore.open("function::stale-id", "Stale box"));

    renderPanel(client({ getNode: async () => null }));

    await waitFor(() => expect(screen.getByTestId("inspector-panel-error")).toBeInTheDocument());
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });
});
