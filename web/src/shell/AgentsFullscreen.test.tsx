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
import { AgentsFullscreen } from "./AgentsFullscreen";

function renderFull() {
  return render(
    <AgentClientProvider client={new MockAgentClient()}>
      <TerminalClientProvider client={terminalClient()}>
      <AgentsFullscreen />
    </TerminalClientProvider>
    </AgentClientProvider>,
  );
}

describe("AgentsFullscreen", () => {
  it("renders nothing unless full", () => {
    seed(2);

    renderFull();

    expect(screen.queryByTestId("agents-fullscreen")).toBeNull();
  });

  it("shows every agent as an equal column", () => {
    seed(2);
    shellStore.agentsFull();

    renderFull();

    expect(screen.getByTestId("agents-column-ag1")).toBeInTheDocument();
    expect(screen.getByTestId("agents-column-ag2")).toBeInTheDocument();
    expect(screen.getByTestId("agents-fullscreen").style.gridTemplateColumns).toContain("repeat(2");
  });

  it("wraps four or more agents into a grid", () => {
    seed(4);
    shellStore.agentsFull();

    renderFull();

    expect(screen.getByTestId("agents-fullscreen").style.gridTemplateColumns).toContain("repeat(2");
  });

  it("returns to normal on the back button and on Escape", () => {
    seed(1);
    shellStore.agentsFull();
    renderFull();

    fireEvent.click(screen.getByTestId("agents-fullscreen-back"));
    const afterButton = shellStore.getState().agents.mode;
    act(() => shellStore.agentsFull());
    fireEvent.keyDown(window, { key: "Escape" });

    expect(afterButton).toBe("normal");
    expect(shellStore.getState().agents.mode).toBe("normal");
  });
});
