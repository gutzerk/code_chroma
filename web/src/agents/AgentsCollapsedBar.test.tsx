import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord } from "../state/types";
import { agentStore } from "./agentStore";
import { AgentsCollapsedBar } from "./AgentsCollapsedBar";

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

beforeEach(() => {
  agentStore.reset();
  layoutStore.reset();
});

afterEach(cleanup);

describe("AgentsCollapsedBar", () => {
  it("shows one a1/a2 button per agent", () => {
    agentStore.upsert(record("one", "first"));
    agentStore.upsert(record("two", "second"));

    render(<AgentsCollapsedBar />);

    expect(screen.getByRole("button", { name: "Open first" })).toHaveTextContent("a1");
    expect(screen.getByRole("button", { name: "Open second" })).toHaveTextContent("a2");
  });

  it("opens the normal panel with that agent selected on click", () => {
    agentStore.upsert(record("one", "first"));
    agentStore.upsert(record("two", "second"));
    layoutStore.setAgentsMode("collapsed");
    render(<AgentsCollapsedBar />);

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));

    expect(layoutStore.getState()).toMatchObject({ agentsMode: "normal", selectedAgentId: "two" });
  });
});
