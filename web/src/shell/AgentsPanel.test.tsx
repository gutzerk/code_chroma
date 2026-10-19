import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord } from "../state/types";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import type { TerminalClient, TerminalSession } from "../terminal/TerminalClient";
import { agentStore } from "../agents/agentStore";
import { branchStore } from "../agents/branchStore";
import { shellStore } from "./shellStore";

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
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit(): void {} } }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    clearTextureAtlas(): void {}
    dispose(): void {}
  },
}));

function record(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: id,
    kind: "claude",
    branch: `agent/${id}`,
    base_branch: "main",
    worktree: `/tmp/${id}`,
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: 1,
    window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
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

function seed(n: number): void {
  for (let i = 1; i <= n; i += 1) agentStore.upsert(record(`ag${i}`));
}

beforeEach(() => {
  window.localStorage.clear();
  agentStore.reset();
  branchStore.reset();
  shellStore.reset();
});

afterEach(() => {
  cleanup();
});

import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { AgentsPanel } from "./AgentsPanel";

function renderPanel(props: Parameters<typeof AgentsPanel>[0] = {}) {
  return render(
    <AgentClientProvider client={new MockAgentClient()}>
      <TerminalClientProvider client={terminalClient()}>
      <AgentsPanel {...props} />
    </TerminalClientProvider>
    </AgentClientProvider>,
  );
}

describe("AgentsPanel", () => {
  it("shows the empty state with a Run agent hint", () => {
    const onRunAgent = vi.fn();

    renderPanel({ onRunAgent });
    fireEvent.click(screen.getByText("Run agent"));

    expect(screen.getByTestId("agents-empty")).toBeInTheDocument();
    expect(onRunAgent).toHaveBeenCalledOnce();
  });

  it.each([1, 2, 5])("renders a tab per agent for %i agents", (n) => {
    seed(n);

    renderPanel();

    expect(screen.getAllByRole("tab")).toHaveLength(n);
    expect(screen.getByTestId("agents-tab-ag1")).toHaveAttribute("aria-selected", "true");
  });

  it("switches the visible body and keeps the other terminal mounted", () => {
    seed(2);
    renderPanel();

    fireEvent.click(screen.getByTestId("agents-tab-ag2"));

    expect(shellStore.getState().agents.activeId).toBe("ag2");
    expect(screen.getByTestId("agent-body-ag1")).not.toBeVisible();
    expect(screen.getByTestId("agent-body-ag2")).toBeVisible();
    expect(screen.getByTestId("agent-terminal-ag1")).toBeInTheDocument();
  });

  it("handle actions go full screen and collapse", () => {
    seed(1);
    renderPanel();

    fireEvent.click(screen.getByLabelText("Full screen agents"));
    const full = shellStore.getState().agents.mode;
    act(() => shellStore.reset());
    fireEvent.click(screen.getByLabelText("Collapse agents"));

    expect(full).toBe("full");
    expect(shellStore.getState().agents.mode).toBe("collapsed");
  });

  it("renders the code overlay over the still-mounted terminals only when open", () => {
    seed(1);
    renderPanel({ codeOverlay: <div data-testid="overlay-content" /> });
    const before = screen.queryByTestId("overlay-content");

    act(() => shellStore.openCodeOverlay());

    expect(before).toBeNull();
    expect(screen.getByTestId("overlay-content")).toBeInTheDocument();
    expect(screen.getByTestId("agent-terminal-ag1")).toBeInTheDocument();
  });
});
