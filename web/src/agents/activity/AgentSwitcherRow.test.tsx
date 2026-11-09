import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentList, AgentSwitcherRow } from "./AgentSwitcherRow";
import { agentStore } from "../agentStore";
import { AgentClientProvider } from "../AgentClientContext";
import { MockAgentClient } from "../mockAgentClient";
import type { AgentRecord, AgentStatus } from "../../state/types";

const WINDOW = { x: 0, y: 0, width: 300, height: 300, minimized: false, z: 1 };

function agent(id: string, status: AgentStatus): AgentRecord {
  return { id, title: `Agent ${id}`, status, kind: "claude", branch: "main", window: WINDOW } as AgentRecord;
}

function renderWithClient(ui: React.ReactNode) {
  return render(<AgentClientProvider client={new MockAgentClient()}>{ui}</AgentClientProvider>);
}

afterEach(() => {
  cleanup();
  agentStore.reset();
});

describe("AgentSwitcherRow", () => {
  it.each(["working", "blocked", "error", "done", "idle", "stopped"] as const)(
    "tints the %s agent's full-screen row through data-status and names the status in text",
    (status) => {
      renderWithClient(<AgentList agents={[agent("a1", status)]} activeId="a1" />);

      const row = screen.getByTestId("agent-tab-a1");

      expect(row).toHaveAttribute("data-status", status);
      expect(row.querySelector(".visually-hidden")?.textContent).not.toBe("");
    },
  );

  it("draws no status dot in the agent rows", () => {
    renderWithClient(<AgentList agents={[agent("a1", "working"), agent("a2", "error")]} activeId="a1" />);

    const dots = document.querySelectorAll(".status-ind");

    expect(dots).toHaveLength(0);
  });

  it("raises a row with an open question to blocked and says how many questions", () => {
    agentStore.upsert({ ...agent("a1", "working"), open_questions: 2 });
    renderWithClient(<AgentList agents={[agent("a1", "working")]} activeId="a1" />);

    const row = screen.getByTestId("agent-tab-a1");

    expect(row).toHaveAttribute("data-status", "blocked");
    expect(row).toHaveTextContent("Needs you · 2 questions");
  });

  it("marks only the selected row as current, leaving the status tint on every row", () => {
    renderWithClient(<AgentList agents={[agent("a1", "done"), agent("a2", "error")]} activeId="a2" />);

    const selected = screen.getByTestId("agent-tab-a2");
    const other = screen.getByTestId("agent-tab-a1");

    expect(selected).toHaveAttribute("aria-current", "true");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).toHaveAttribute("data-status", "done");
  });

  it("tints the dropdown trigger and each menu option by status", () => {
    const agents = [agent("a1", "blocked"), agent("a2", "stopped")];
    renderWithClient(<AgentSwitcherRow agents={agents} activeId="a1" />);

    act(() => fireEvent.click(screen.getByRole("button", { name: "Select agent" })));

    expect(screen.getByTestId("agent-switcher-trigger")).toHaveAttribute("data-status", "blocked");
    expect(screen.getByTestId("agent-option-a2")).toHaveAttribute("data-status", "stopped");
  });
});
