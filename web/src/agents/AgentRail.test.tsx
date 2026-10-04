import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { collapsedLayersStore } from "../canvas/doc/collapsedLayersStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../engine-client/stubEngineClient";
import type { AgentRecord, AgentWindowGeometry, CanvasElement } from "../state/types";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { agentDockStore } from "./agentDockStore";
import { branchStore } from "./branchStore";
import { AgentRail } from "./AgentRail";

const ENGINE_CLIENT_STUB = IMPACT_CHANGES_STUB as unknown as EngineClient;

function diagramElement(id: string, layer: string): CanvasElement {
  return {
    id,
    render: "c1",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
  };
}

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "refund-flow",
    title: "refund flow",
    kind: "claude",
    branch: "agent/refund-flow",
    base_branch: "main",
    worktree: "/tmp/worktrees/refund-flow",
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 100, y: 120, width: 720, height: 480, minimized: false, z: 1 },
    status: "stopped",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

type Saved = [string, Partial<AgentWindowGeometry>];

function agentClient(saved: Saved[], switched: string[] = [], removed: string[] = []): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => record(),
    start: async () => record(),
    stop: async () => record(),
    remove: async (id) => {
      removed.push(id);
    },
    saveWindow: async (id, window) => {
      saved.push([id, window]);
    },
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "GitHub CLI required", dirty: [] }),
    createPr: async () => ({ ...record(), pr_url: "https://github.com/acme/app/pull/1" }),
    recreateWorktree: async () => record(),
    activateWorkspace: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => {
      switched.push(branch);
      return { current: branch, branches: ["main", "feature-x"] };
    },
    updateBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
  };
}

function renderRail(
  saved: Saved[] = [],
  switched: string[] = [],
  removed: string[] = [],
  engineClientOverride: Partial<EngineClient> = {},
) {
  return render(
    <EngineClientProvider
      repoId="main"
      client={{ ...ENGINE_CLIENT_STUB, ...engineClientOverride } as EngineClient}
    >
      <AgentClientProvider client={agentClient(saved, switched, removed)}>
        <AgentRail />
      </AgentClientProvider>
    </EngineClientProvider>,
  );
}

beforeEach(() => {
  agentStore.reset();
  agentDockStore.reset();
  branchStore.reset();
  canvasDocStore.reset();
  collapsedLayersStore.reset();
});

afterEach(cleanup);

describe("the rail's agent strip", () => {
  it("always mounts, even with neither agents nor on-canvas diagrams", () => {
    renderRail();

    expect(screen.getByTestId("agent-task-rail")).toBeInTheDocument();
  });

  it("keeps an entry for every agent, minimized or not, carrying its status colour", () => {
    agentStore.upsert(record({ status: "blocked" }));
    agentStore.upsert(record({ id: "flaky-tests", title: "flaky tests", status: "working" }));
    renderRail();

    const entries = screen.getAllByTestId(/^agent-rail-/);

    expect(entries).toHaveLength(2);
    expect(entries[0].querySelector(".agent-led")).toHaveClass("agent-led-blocked");
    expect(entries[1].querySelector(".agent-led")).toHaveClass("agent-led-working");
  });

  it("names the agent and its status in the hover label, since the dot alone says neither", () => {
    agentStore.upsert(record({ status: "idle" }));
    renderRail();

    expect(screen.getByTestId("agent-rail-refund-flow").querySelector(".rail-tooltip")).toHaveTextContent(
      "refund flow — Idle",
    );
  });

  // aria-label overrides the button's accessible name entirely, so the visible status/branch text
  // next to the LED must be repeated there too, or a screen reader hears only the bare title.
  it("carries the same status text in its accessible name as it shows visually", () => {
    agentStore.upsert(record({ status: "idle" }));
    renderRail();

    expect(screen.getByTestId("agent-rail-refund-flow")).toHaveAttribute(
      "aria-label",
      "refund flow — Idle",
    );
  });

  it("presses the entry of an open window and releases it for a minimized one", () => {
    agentStore.upsert(record({ window: { ...record().window, minimized: false } }));
    agentStore.upsert(
      record({ id: "flaky-tests", window: { ...record().window, minimized: true } }),
    );
    renderRail();

    expect(screen.getByTestId("agent-rail-refund-flow")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("agent-rail-flaky-tests")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps docked agents pressed and selects their tab from the rail", () => {
    agentStore.upsert(record());
    agentStore.upsert(record({ id: "flaky-tests", title: "flaky tests" }));
    agentDockStore.attach("refund-flow");
    agentDockStore.attach("flaky-tests");
    renderRail();

    expect(screen.getByTestId("agent-rail-flaky-tests")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("agent-rail-refund-flow"));

    expect(agentDockStore.getActiveAgentId()).toBe("refund-flow");
  });

  it("minimizes an open agent on click, and tells the bridge", () => {
    const saved: Saved[] = [];
    agentStore.upsert(record());
    renderRail(saved);

    fireEvent.click(screen.getByTestId("agent-rail-refund-flow"));

    expect(agentStore.getAgent("refund-flow")?.window.minimized).toBe(true);
    expect(saved).toEqual([["refund-flow", { minimized: true }]]);
  });

  // Restore used to be store-only, so a reopened window came back minimized after a reload.
  it("restores a minimized agent on click, raises it, and persists both", () => {
    const saved: Saved[] = [];
    agentStore.upsert(record({ window: { ...record().window, minimized: true, z: 3 } }));
    renderRail(saved);

    fireEvent.click(screen.getByTestId("agent-rail-refund-flow"));

    expect(agentStore.getAgent("refund-flow")?.window).toMatchObject({ minimized: false, z: 4 });
    expect(saved).toEqual([["refund-flow", { minimized: false, z: 4 }]]);
  });

  // A hidden window's only remaining trace: dropping the row too would lose the agent entirely.
  it("keeps an agent from another branch listed, dimmed, and named by its branch", () => {
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    agentStore.upsert(record({ id: "on-main", base_branch: "main" }));
    agentStore.upsert(record({ id: "elsewhere", base_branch: "feature-x" }));
    renderRail();

    expect(screen.getByTestId("agent-rail-on-main")).not.toHaveClass("agent-rail-item-off-branch");
    const away = screen.getByTestId("agent-rail-elsewhere");
    expect(away).toHaveClass("agent-rail-item-off-branch");
    expect(away.querySelector(".agent-rail-status")).toHaveTextContent("on feature-x");
  });

  // Its window is always visible regardless of branch now (AgentWindow.tsx), so an off-branch row's
  // click behaves exactly like any other row's -- no checkout attempt, ever (see AgentRail.tsx's own
  // comment for the incident a forced checkout here used to cause).
  it("minimizes an open off-branch agent on click, without switching branches", async () => {
    const saved: Saved[] = [];
    const switched: string[] = [];
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    agentStore.upsert(record({ id: "elsewhere", base_branch: "feature-x" }));
    renderRail(saved, switched);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-rail-elsewhere"));
    });

    expect(saved).toEqual([["elsewhere", { minimized: true }]]);
    expect(switched).toEqual([]);
    expect(branchStore.getCurrent()).toBe("main");
  });

  it("restores a minimized off-branch agent on click, without switching branches", async () => {
    const switched: string[] = [];
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    agentStore.upsert(
      record({
        id: "elsewhere",
        base_branch: "feature-x",
        window: { ...record().window, minimized: true },
      }),
    );
    renderRail([], switched);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-rail-elsewhere"));
    });

    expect(agentStore.getAgent("elsewhere")?.window.minimized).toBe(false);
    expect(switched).toEqual([]);
  });

  it("offers a close button for an off-branch agent, since its window/close is hidden", () => {
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    agentStore.upsert(record({ id: "on-main", base_branch: "main" }));
    agentStore.upsert(record({ id: "elsewhere", base_branch: "feature-x" }));
    renderRail();

    expect(screen.queryByTestId("agent-rail-close-on-main")).toBeNull();
    expect(screen.getByTestId("agent-rail-close-elsewhere")).toBeInTheDocument();
  });

  it("defers an off-branch agent's × to the confirm dialog, never removing or switching branches", async () => {
    const switched: string[] = [];
    const removed: string[] = [];
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    agentStore.upsert(record({ id: "elsewhere", base_branch: "feature-x" }));
    renderRail([], switched, removed);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-rail-close-elsewhere"));
    });

    // Last agent on its own worktree, so the close is deferred to the confirm dialog: nothing is
    // removed and no branch switch happens — the dialog answers what happens to the worktree.
    expect(agentStore.getPendingClose()).toBe("elsewhere");
    expect(removed).toEqual([]);
    expect(switched).toEqual([]);
    expect(agentStore.getAgent("elsewhere")).toBeDefined();
  });

  it("shows the task title and status as text, not just the LED colour", () => {
    agentStore.upsert(record({ title: "refund flow", status: "blocked" }));
    renderRail();

    const entry = screen.getByTestId("agent-rail-refund-flow");
    expect(entry.querySelector(".agent-rail-title")).toHaveTextContent("refund flow");
    expect(entry.querySelector(".agent-rail-status")).toHaveTextContent("Blocked");
  });

  it("badges an agent that drew a diagram in its own, unvisited workspace", () => {
    agentStore.upsert(record({ status: "idle" }));
    agentStore.markDiagramsReady("refund-flow");
    renderRail();

    expect(screen.getByTestId("diagram-ready-refund-flow")).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-rail-refund-flow").querySelector(".rail-tooltip"),
    ).toHaveTextContent("drew a diagram");
  });

  it("clears the diagram badge once the row is clicked", () => {
    agentStore.upsert(record({ status: "idle", window: { ...record().window, minimized: true } }));
    agentStore.markDiagramsReady("refund-flow");
    renderRail();

    act(() => {
      fireEvent.click(screen.getByTestId("agent-rail-refund-flow"));
    });

    expect(screen.queryByTestId("diagram-ready-refund-flow")).toBeNull();
  });
});

describe("the rail's Diagrams tab", () => {
  it("renders with a diagram on canvas even with no agents at all", () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    renderRail();

    expect(screen.getByTestId("agent-task-rail")).toBeInTheDocument();
    expect(screen.getByTestId("agent-task-rail-tab-diagrams")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches between the Agents and Diagrams tabs, mutually exclusive", () => {
    agentStore.upsert(record());
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    renderRail();

    expect(screen.getByTestId("agent-rail-refund-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-rail-c1")).toBeNull();

    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));

    expect(screen.queryByTestId("agent-rail-refund-flow")).toBeNull();
    expect(screen.getByTestId("diagram-rail-c1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agent-task-rail-tab-agents"));

    expect(screen.getByTestId("agent-rail-refund-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-rail-c1")).toBeNull();
  });

  it("lists every distinct diagram layer, not hierarchy or default", () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: {
        seed: { ...diagramElement("seed", "hierarchy"), render: "hierarchy" },
        note: { ...diagramElement("note", "default"), render: "note" },
        c1a: diagramElement("c1a", "c1"),
        c1b: diagramElement("c1b", "c1"),
        patternsA: { ...diagramElement("patternsA", "patterns"), render: "pattern" },
      },
    });
    renderRail();

    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));

    expect(screen.getAllByTestId(/^diagram-rail-/)).toHaveLength(2);
    expect(screen.getByTestId("diagram-rail-c1")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-rail-patterns")).toBeInTheDocument();
  });

  it("toggles a diagram's collapsed state on click, without touching the canvas document", () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    renderRail();
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));

    const row = screen.getByTestId("diagram-rail-c1");
    expect(row).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);
    expect(canvasDocStore.getDoc().elements.c1a).toBeDefined();

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
  });

  it("re-expands a collapsed diagram without re-running its recipe", async () => {
    const docWithC1 = { ...canvasDocStore.getDoc(), elements: { c1a: diagramElement("c1a", "c1") } };
    canvasDocStore.setDoc(docWithC1);
    collapsedLayersStore.collapse("c1");
    const runRecipe = vi.fn();

    renderRail([], [], [], { runRecipe });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));
    const row = screen.getByTestId("diagram-rail-c1");
    expect(row).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(row);
    });

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("does not re-run the recipe when collapsing a diagram", async () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    const runRecipe = vi.fn();

    renderRail([], [], [], { runRecipe });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));
    const row = screen.getByTestId("diagram-rail-c1");
    expect(row).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(row);
    });

    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("expands a one-off, non-recipe-backed layer without calling the recipe route", async () => {
    // A diagram a skill/agent PATCHed straight onto the canvas (see diagramCatalog.ts's
    // listActiveDiagramLayers) has no backing recipe -- runRecipeAndLayout would 404 on it.
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { x1: diagramElement("x1", "Serving Unit TLS Process (LMP-126)") },
    });
    collapsedLayersStore.collapse("Serving Unit TLS Process (LMP-126)");
    const runRecipe = vi.fn();

    renderRail([], [], [], { runRecipe });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));
    const row = screen.getByTestId("diagram-rail-Serving Unit TLS Process (LMP-126)");
    expect(row).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(row);
    });

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(runRecipe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("diagram-rail-error")).toBeNull();
  });

  it("shows the empty state in the Diagrams tab with no on-canvas layers", async () => {
    agentStore.upsert(record());
    renderRail();

    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));

    await waitFor(() => expect(screen.getByText(/No diagrams yet/)).toBeInTheDocument());
  });

  it("opens a confirm dialog naming the diagram, and does nothing on Cancel", () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    const deleteDiagram = vi.fn();
    renderRail([], [], [], { deleteDiagram });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));

    fireEvent.click(screen.getByTestId("diagram-delete-c1"));

    expect(screen.getByTestId("delete-diagram-dialog")).toHaveTextContent('Delete "C1"?');
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByTestId("delete-diagram-dialog")).toBeNull();
    expect(deleteDiagram).not.toHaveBeenCalled();
    expect(canvasDocStore.getDoc().elements.c1a).toBeDefined();
  });

  it("deletes the diagram's file and removes its layer from the canvas on confirm", async () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    const deleteDiagram = vi.fn(async () => ({ deleted: true }));
    const patchCanvas = vi.fn(async () => ({
      ok: true as const,
      batch_id: "b1",
      id_map: {},
      affected: [],
    }));
    renderRail([], [], [], { deleteDiagram, patchCanvas });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));
    fireEvent.click(screen.getByTestId("diagram-delete-c1"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-diagram-confirm"));
    });

    expect(deleteDiagram).toHaveBeenCalledWith("c1");
    expect(patchCanvas).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("delete-diagram-dialog")).toBeNull());
  });

  it("keeps the dialog open and shows the error when the delete fails", async () => {
    canvasDocStore.setDoc({
      ...canvasDocStore.getDoc(),
      elements: { c1a: diagramElement("c1a", "c1") },
    });
    const deleteDiagram = vi.fn(async () => {
      throw new Error("disk error");
    });
    renderRail([], [], [], { deleteDiagram });
    fireEvent.click(screen.getByTestId("agent-task-rail-tab-diagrams"));
    fireEvent.click(screen.getByTestId("diagram-delete-c1"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-diagram-confirm"));
    });

    expect(screen.getByTestId("delete-diagram-dialog")).toHaveTextContent("disk error");
    expect(canvasDocStore.getDoc().elements.c1a).toBeDefined();
  });
});
