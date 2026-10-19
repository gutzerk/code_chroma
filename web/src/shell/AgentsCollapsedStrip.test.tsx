import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord } from "../state/types";
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

import { AgentsCollapsedStrip } from "./AgentsCollapsedStrip";

describe("AgentsCollapsedStrip", () => {
  it("renders nothing unless collapsed", () => {
    seed(2);

    render(<AgentsCollapsedStrip />);

    expect(screen.queryByTestId("agents-strip")).toBeNull();
  });

  it("opens the panel on the clicked agent", () => {
    seed(2);
    shellStore.agentsStepOut();
    render(<AgentsCollapsedStrip />);

    fireEvent.click(screen.getByTestId("agents-strip-ag2"));

    expect(shellStore.getState().agents).toMatchObject({ mode: "normal", activeId: "ag2" });
  });

  it("shows five buttons and a +n menu for the rest", () => {
    seed(7);
    shellStore.agentsStepOut();
    render(<AgentsCollapsedStrip />);

    const more = screen.getByTestId("agents-strip-more");
    fireEvent.click(more);
    fireEvent.click(screen.getByTestId("agents-strip-ag7"));

    expect(more).toHaveTextContent("+2");
    expect(shellStore.getState().agents.activeId).toBe("ag7");
  });
});
