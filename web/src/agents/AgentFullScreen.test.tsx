import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord } from "../state/types";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { AgentFullScreen } from "./AgentFullScreen";

vi.mock("./AgentTerminal", () => ({
  AgentTerminal: ({ workspace }: { workspace: string }) => <div data-testid={`term-${workspace}`} />,
}));

function record(id: string, title: string): AgentRecord {
  return {
    id,
    title,
    kind: "claude",
    branch: `agent/${id}`,
    worktree: `/tmp/${id}`,
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
    status: "idle",
    exit_code: null,
    worktree_lost: false,
  };
}

function renderFull() {
  return render(
    <AgentClientProvider client={PR_CLIENT_STUB as unknown as AgentClient}>
      <AgentFullScreen />
    </AgentClientProvider>,
  );
}

beforeEach(() => {
  agentStore.reset();
  layoutStore.reset();
  agentStore.upsert(record("one", "first"));
  agentStore.upsert(record("two", "second"));
});

afterEach(cleanup);

describe("AgentFullScreen", () => {
  it("lists a tab per agent and shows one window for the selected one", () => {
    layoutStore.selectAgent("two");

    renderFull();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /second/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "second" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message second" })).toBeInTheDocument();
  });

  it("switches the window when another tab is clicked", () => {
    layoutStore.selectAgent("one");
    renderFull();

    fireEvent.click(screen.getByRole("tab", { name: /second/ }));

    expect(layoutStore.getState().selectedAgentId).toBe("two");
    expect(screen.getByTestId("term-two")).toBeInTheDocument();
  });

  it("goes back to the side panel from the edge handle", () => {
    layoutStore.setAgentsMode("full");
    renderFull();

    fireEvent.click(screen.getByRole("button", { name: "Back to side panel" }));

    expect(layoutStore.getState().agentsMode).toBe("normal");
  });

  it("offers a New agent button", () => {
    renderFull();

    expect(screen.getByRole("button", { name: "New agent" })).toBeEnabled();
  });
});

describe("AgentFullScreen selection", () => {
  it("falls back to the first agent when the selected one is gone", () => {
    layoutStore.selectAgent("gone");

    renderFull();

    expect(screen.getByRole("tab", { name: /first/ })).toHaveAttribute("aria-selected", "true");
  });
});
