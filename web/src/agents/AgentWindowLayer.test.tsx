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
  agentStore.reset();
  vi.mocked(flagDiagramsReady).mockClear();
});

afterEach(cleanup);

describe("AgentWindowLayer", () => {
  // Filtering minimized agents out of the render unmounted their xterm, so every restore paid for a
  // full reattach — the one path where a redraw can still disagree with what the agent last drew.
  it("keeps a minimized agent's window mounted and hidden rather than unmounting it", async () => {
    renderLayer([record()]);

    await waitFor(() => expect(screen.getByTestId("agent-window-refund-flow")).toBeInTheDocument());

    expect(screen.getByTestId("agent-window-refund-flow")).toHaveClass("agent-window-hidden");
    expect(screen.getByTestId("agent-terminal-refund-flow")).toBeInTheDocument();
  });

  // A monitor unplugged mid-session shrinks the browser window in place, which used to leave a
  // window's title bar off-screen with no way to drag it back (agentStore.clampToViewport only ever
  // ran against a freshly-loaded/upserted record, never in response to the browser itself resizing).
  it("pulls a window back on-screen when the browser viewport shrinks in place", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    window.innerWidth = 2400;
    window.innerHeight = 1400;
    try {
      renderLayer([
        record({ window: { x: 2000, y: 1200, width: 720, height: 480, minimized: false, z: 1 } }),
      ]);
      await waitFor(() =>
        expect(screen.getByTestId("agent-window-refund-flow")).toHaveStyle({ left: "2000px" }),
      );

      window.innerWidth = 1024;
      window.innerHeight = 768;
      window.dispatchEvent(new Event("resize"));

      await waitFor(() =>
        expect(screen.getByTestId("agent-window-refund-flow")).not.toHaveStyle({ left: "2000px" }),
      );
    } finally {
      window.innerWidth = originalWidth;
      window.innerHeight = originalHeight;
    }
  });

  // There is no more panel, and nothing else lives in this corner either.
  it("renders no agent-corner element at all", async () => {
    renderLayer([record()]);

    await waitFor(() => expect(screen.getByTestId("agent-window-refund-flow")).toBeInTheDocument());

    expect(document.querySelector(".agent-corner")).toBeNull();
  });

  // An agent's own worktree runs regardless of what main has checked out (main can't touch it
  // either way), so its window must stay reachable too -- a dirty main tree that refuses a checkout
  // must never be able to trap an agent's window behind it. See AgentRail.tsx's own comment for the
  // incident this replaced (a window hidden this way, with the checkout that would reveal it again
  // refusing forever).
  it("still shows an agent's window even when its own branch differs from the one main has checked out", async () => {
    const onFeatureX = record({
      id: "on-feature-x",
      base_branch: "feature-x",
      window: { ...record().window, minimized: false },
    });
    const client: AgentClient = {
      ...agentClient([onFeatureX]),
      getBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    };

    render(
      <EngineClientProvider repoId="main" client={IMPACT_CHANGES_STUB as unknown as EngineClient}>
        <AgentClientProvider client={client}>
          <TerminalClientProvider client={terminalClient()}>
            <AgentWindowLayer />
          </TerminalClientProvider>
        </AgentClientProvider>
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("agent-window-on-feature-x")).toBeInTheDocument());
    expect(screen.getByTestId("agent-window-on-feature-x")).not.toHaveClass("agent-window-hidden");
  });

  it("shows an agent's window whose own branch still matches the one main has checked out", async () => {
    const onMain = record({
      id: "on-main",
      base_branch: "main",
      window: { ...record().window, minimized: false },
    });
    const client: AgentClient = {
      ...agentClient([onMain]),
      getBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    };

    render(
      <EngineClientProvider repoId="main" client={IMPACT_CHANGES_STUB as unknown as EngineClient}>
        <AgentClientProvider client={client}>
          <TerminalClientProvider client={terminalClient()}>
            <AgentWindowLayer />
          </TerminalClientProvider>
        </AgentClientProvider>
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("agent-window-on-main")).toBeInTheDocument());
    expect(screen.getByTestId("agent-window-on-main")).not.toHaveClass("agent-window-hidden");
  });

  // launchAgent (no panel left to own this) publishes a blocked preflight straight to the store;
  // the layer must still surface it as GitInitDialog rather than swallowing it.
  it("shows the git-init dialog once launchAgent publishes a blocked preflight to the store", async () => {
    renderLayer([]);
    await waitFor(() => expect(screen.queryByTestId("git-init-dialog")).not.toBeInTheDocument());

    agentStore.setGitPreflight({ state: "no-git", root: "/repo" });

    await waitFor(() => expect(screen.getByTestId("git-init-dialog")).toBeInTheDocument());
  });

  it("shows the close-confirmation dialog for the agent awaiting its worktree's fate", async () => {
    renderLayer([record()]);
    await waitFor(() => expect(screen.getByTestId("agent-window-refund-flow")).toBeInTheDocument());
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
