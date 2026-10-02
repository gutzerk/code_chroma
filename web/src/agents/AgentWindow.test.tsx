import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord } from "../state/types";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import type { TerminalClient, TerminalSession } from "../terminal/TerminalClient";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { AgentWindow } from "./AgentWindow";
import { branchStore } from "./branchStore";

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
    window: { x: 100, y: 120, width: 720, height: 480, minimized: false, z: 1 },
    status: "running",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
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

function agentClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => record(),
    start: async () => record(),
    stop: async () => record({ status: "stopped" }),
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "GitHub CLI required", dirty: [] }),
    createPr: async () => ({ ...record(), pr_url: "https://github.com/acme/app/pull/1" }),
    recreateWorktree: async () => record(),
    activateWorkspace: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }),
    workspaceStatus: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
    ...overrides,
  };
}

function renderWindow(agent: AgentRecord, client: AgentClient = agentClient()) {
  return render(
    <AgentClientProvider client={client}>
      <TerminalClientProvider client={terminalClient()}>
        <AgentWindow agent={agent} />
      </TerminalClientProvider>
    </AgentClientProvider>,
  );
}

beforeEach(() => {
  agentStore.reset();
  branchStore.reset();
});

afterEach(() => {
  cleanup();
  branchStore.reset();
});

describe("AgentWindow", () => {
  it("renders the agent's title and branch in its title bar", () => {
    renderWindow(record());

    expect(screen.getByText("refund flow")).toBeInTheDocument();
    expect(screen.getByText("agent/refund-flow")).toBeInTheDocument();
  });

  // A stale manual resize used to permanently win over `geometry.width/height`, so a later
  // agentStore.reclampToViewport() shrinking a window (e.g. a monitor unplugged) never showed once
  // the user had ever dragged that window's own resize handle.
  it("drops a stale manual resize once the window's geometry changes for some other reason", () => {
    const base = record();
    const { rerender } = renderWindow(base);
    const panel = screen.getByTestId("agent-window-refund-flow");
    panel.getBoundingClientRect = () =>
      ({ width: 720, height: 480, left: 0, top: 0, right: 720, bottom: 480, x: 0, y: 0 }) as DOMRect;
    const handle = screen.getByTestId("agent-resize-refund-flow");
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 720, clientY: 480 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900, clientY: 480 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900, clientY: 480 });
    expect(panel.style.width).toBe("900px");

    rerender(
      <AgentClientProvider client={agentClient()}>
        <TerminalClientProvider client={terminalClient()}>
          <AgentWindow agent={record({ window: { ...base.window, width: 500 } })} />
        </TerminalClientProvider>
      </AgentClientProvider>,
    );

    expect(panel.style.width).toBe("500px");
  });

  it("keeps the terminal mounted when minimized, so the xterm buffer survives", () => {
    const { rerender } = renderWindow(record());
    const minimized = record({ window: { ...record().window, minimized: true } });

    rerender(
      <AgentClientProvider client={agentClient()}>
        <TerminalClientProvider client={terminalClient()}>
          <AgentWindow agent={minimized} />
        </TerminalClientProvider>
      </AgentClientProvider>,
    );

    expect(screen.getByTestId("agent-terminal-refund-flow")).toBeInTheDocument();
    expect(screen.getByTestId("agent-window-refund-flow")).toHaveClass("agent-window-hidden");
  });

  // An agent's own worktree is untouched by whatever main has checked out, so its window must stay
  // visible either way -- a dirty main tree that refuses a checkout must never be able to trap it
  // behind a hidden window with no reachable close button (see AgentRail.tsx's own comment).
  it("keeps an agent's window visible even when it belongs to another branch", () => {
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
    const away = record({ base_branch: "feature-x" });
    renderWindow(away);

    expect(screen.getByTestId("agent-window-refund-flow")).not.toHaveClass("agent-window-hidden");
  });

  it("persists the minimized flag through the bridge when the minimize button is pressed", () => {
    const saved: Array<[string, unknown]> = [];
    renderWindow(
      record(),
      agentClient({
        saveWindow: async (id, window) => {
          saved.push([id, window]);
        },
      }),
    );

    fireEvent.click(screen.getByLabelText("Minimize refund flow"));

    expect(saved).toEqual([["refund-flow", { minimized: true }]]);
  });

  it("defers a last-on-its-own-worktree agent to the confirm dialog on ×, not deleting anything yet", async () => {
    const removed: unknown[] = [];
    agentStore.upsert(record());
    renderWindow(record(), agentClient({ remove: async (...args) => void removed.push(args) }));

    fireEvent.click(screen.getByLabelText("Close refund flow"));

    // The agent is the last one on its own worktree, so "×" raises the confirm dialog instead of
    // firing the delete; nothing is removed, and the card stays until the dialog is answered.
    expect(agentStore.getPendingClose()).toBe("refund-flow");
    await Promise.resolve();
    expect(removed).toEqual([]);
    expect(agentStore.getAgents().length).toBe(1);
  });

  it("offers only minimize and close in the title bar", () => {
    renderWindow(record());

    expect(screen.getByLabelText("Minimize refund flow")).toBeInTheDocument();
    expect(screen.getByLabelText("Close refund flow")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resume refund flow")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove refund flow")).not.toBeInTheDocument();
  });

  it("keeps × as the only session control once the agent has stopped on its own", () => {
    renderWindow(record({ status: "stopped", pid: null }));

    expect(screen.getByLabelText("Close refund flow")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resume refund flow")).not.toBeInTheDocument();
  });

  it("explains itself instead of showing a dead terminal while the agent is stopped", () => {
    renderWindow(record({ status: "stopped", pid: null }));

    expect(screen.getByTestId("agent-window-idle-refund-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-terminal-refund-flow")).not.toBeInTheDocument();
  });

  it("offers Recreate instead of a terminal once the worktree is gone", () => {
    renderWindow(record({ status: "stopped", pid: null, worktree_lost: true }));

    expect(screen.getByTestId("agent-worktree-lost-refund-flow")).toBeInTheDocument();
    expect(screen.getByTestId("agent-window-idle-refund-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-terminal-refund-flow")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-recreate-worktree-refund-flow")).toBeInTheDocument();
  });

  it("recreates the worktree and clears the lost flag when Recreate is clicked", async () => {
    const recreated: string[] = [];
    renderWindow(
      record({ status: "stopped", pid: null, worktree_lost: true }),
      agentClient({
        recreateWorktree: async (id) => {
          recreated.push(id);
          return record({ status: "stopped", pid: null, worktree_lost: false });
        },
      }),
    );

    fireEvent.click(screen.getByTestId("agent-recreate-worktree-refund-flow"));

    await vi.waitFor(() => expect(recreated).toEqual(["refund-flow"]));
  });

  it("does not offer Create PR while the worktree is lost", () => {
    renderWindow(record({ status: "stopped", pid: null, worktree_lost: true }));

    expect(screen.queryByTestId("agent-create-pr-refund-flow")).not.toBeInTheDocument();
  });

  it("does not offer Create PR for an agent forked from a PR", () => {
    renderWindow(record({ source_pr: "pr-282" }));

    expect(screen.queryByTestId("agent-create-pr-refund-flow")).not.toBeInTheDocument();
  });

  it("closes a worktree-lost agent without asking anything either", async () => {
    const removed: unknown[] = [];
    renderWindow(
      record({ status: "stopped", pid: null, worktree_lost: true }),
      agentClient({ remove: async (...args) => void removed.push(args) }),
    );

    fireEvent.click(screen.getByLabelText("Close refund flow"));

    await vi.waitFor(() => expect(removed).toEqual([["refund-flow"]]));
  });
});
