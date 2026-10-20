import { layoutStore } from "../canvas/layout/layoutStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AgentRecord } from "../state/types";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import { IMPACT_CHANGES_STUB } from "../engine-client/stubEngineClient";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import type { TerminalClient, TerminalSession } from "../terminal/TerminalClient";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { agentDockStore } from "./agentDockStore";
import { flagDiagramsReady } from "./agentDiagramsReady";
import { AgentWindowLayer } from "./AgentWindowLayer";

// Its own behavior is covered in agentDiagramsReady.test.ts; here only the branch that calls it is.
vi.mock("./agentDiagramsReady", () => ({ flagDiagramsReady: vi.fn(async () => {}) }));

vi.mock("@xterm/xterm", () => {
  class Terminal {
    rows = 24;
    cols = 80;
    unicode = { activeVersion: "6" };
    loadAddon(): void {}
    open(): void {}
    focus(): void {}
    write(): void {}
    onData(): void {}
    onBinary(): void {}
    onSelectionChange(): void {}
    getSelection(): string {
      return "";
    }
    dispose(): void {}
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  class FitAddon {
    fit(): void {}
  }
  return { FitAddon };
});

vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    clearTextureAtlas(): void {}
    dispose(): void {}
  },
}));

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
    pid: 4242,
    window: { x: 100, y: 120, width: 720, height: 480, minimized: true, z: 1 },
    status: "running",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

function agentClient(agents: AgentRecord[]): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents, active_workspace: "main", max_agents: 5 }),
    create: async () => record(),
    start: async () => record(),
    stop: async () => record({ status: "stopped" }),
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "gh required", dirty: [] }),
    createPr: async () => ({ ...record(), pr_url: "https://github.com/acme/app/pull/1" }),
    recreateWorktree: async () => record(),
    activateWorkspace: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
  };
}

function terminalClient(): TerminalClient {
  const session: TerminalSession = {
    write: () => {},
    writeBinary: () => {},
    resize: () => {},
    onData: () => {},
    onClose: () => {},
    close: () => {},
  };
  return { connect: () => session };
}

function renderLayer(agents: AgentRecord[], engineOverrides: Partial<EngineClient> = {}) {
  const engineClient = { ...IMPACT_CHANGES_STUB, ...engineOverrides } as unknown as EngineClient;
  return render(
    <EngineClientProvider repoId="main" client={engineClient}>
      <AgentClientProvider client={agentClient(agents)}>
        <TerminalClientProvider client={terminalClient()}>
          <AgentWindowLayer />
        </TerminalClientProvider>
      </AgentClientProvider>
    </EngineClientProvider>,
  );
}

/** Renders the layer and hands back the `subscribeAgents` listener, so a test can push a ping. */
function renderLayerWithPing(agents: AgentRecord[]) {
  let emit: ((message: unknown) => void) | undefined;
  renderLayer(agents, {
    subscribeAgents: (onMessage: (message: never) => void) => {
      emit = onMessage as (message: unknown) => void;
      return () => {};
    },
  } as Partial<EngineClient>);
  return (message: unknown) => emit?.(message);
}

beforeEach(() => {
  window.localStorage.removeItem("codechroma.agentDockCollapsed");
  agentStore.reset();
  agentDockStore.reset();
  layoutStore.reset();
  vi.mocked(flagDiagramsReady).mockClear();
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("codechroma.agentDockCollapsed");
  agentDockStore.reset();
});

describe("AgentWindowLayer", () => {

  it("clears a selection whose agent no longer exists", async () => {
    layoutStore.selectAgent("ghost");
    renderLayer([record()]);

    await waitFor(() => expect(layoutStore.getState().selectedAgentId).toBeNull());
  });

  it("falls back to main when a branch-removed ping names the active workspace", async () => {
    const ping = renderLayerWithPing([]);
    agentStore.setActiveWorkspace("feature-x");

    ping({ type: "branch-removed", id: "feature-x" });

    await waitFor(() => expect(agentStore.getActiveWorkspace()).toBe("main"));
  });

  it("shows the git-init dialog once launchAgent publishes a blocked preflight to the store", async () => {
    renderLayer([]);
    await waitFor(() => expect(screen.queryByTestId("git-init-dialog")).not.toBeInTheDocument());

    agentStore.setGitPreflight({ state: "no-git", root: "/repo" });

    await waitFor(() => expect(screen.getByTestId("git-init-dialog")).toBeInTheDocument());
  });

  it("shows the close-confirmation dialog for the agent awaiting its worktree's fate", async () => {
    renderLayer([record()]);
    await waitFor(() => expect(agentStore.getAgent("refund-flow")).toBeDefined());
    expect(screen.queryByTestId("close-agent-dialog")).not.toBeInTheDocument();

    agentStore.setPendingClose("refund-flow");

    await waitFor(() => expect(screen.getByTestId("close-agent-dialog")).toBeInTheDocument());
    expect(screen.getByTestId("close-agent-delete-worktree")).not.toBeChecked();
  });

  it("checks for a drawn diagram when a 'Draw' task agent finishes", async () => {
    const working = record({ status: "working", context_kind: "task" });
    agentStore.upsert(working);
    const ping = renderLayerWithPing([working]);
    await waitFor(() => expect(screen.getByTestId("agent-layer")).toBeInTheDocument());

    ping({ type: "agent-status", id: "refund-flow", status: "idle" });

    await waitFor(() => expect(flagDiagramsReady).toHaveBeenCalledWith("refund-flow"));
  });

  it("never checks for a diagram when the finished agent was only opened to look around", async () => {
    const working = record({ status: "working", context_kind: "view" });
    agentStore.upsert(working);
    const ping = renderLayerWithPing([working]);
    await waitFor(() => expect(screen.getByTestId("agent-layer")).toBeInTheDocument());

    ping({ type: "agent-status", id: "refund-flow", status: "idle" });

    await waitFor(() => expect(agentStore.getAgent("refund-flow")?.status).toBe("idle"));
    expect(flagDiagramsReady).not.toHaveBeenCalled();
  });
});
