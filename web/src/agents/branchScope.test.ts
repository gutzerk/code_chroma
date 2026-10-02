import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../state/types";
import { isAgentOnBranch } from "./branchScope";

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

describe("isAgentOnBranch", () => {
  it("keeps an agent whose base branch is the checked-out one", () => {
    expect(isAgentOnBranch(record({ base_branch: "main" }), "main")).toBe(true);
  });

  it("drops an agent that belongs to another branch", () => {
    expect(isAgentOnBranch(record({ base_branch: "feature-x" }), "main")).toBe(false);
  });

  // A record written before the field exists must not vanish: it would take a live agent with it.
  it("keeps a legacy agent that has no base branch recorded", () => {
    expect(isAgentOnBranch(record({ base_branch: null }), "main")).toBe(true);
  });

  // 🔴 Caught live: a bridge older than the field omits it, `undefined` matched no branch name, and
  // every agent of every such bridge had its window hidden with "on undefined" in the rail.
  it("keeps an agent whose record has no base_branch key at all", () => {
    const legacy = record();
    delete legacy.base_branch;

    expect(isAgentOnBranch(legacy, "main")).toBe(true);
  });

  it("keeps every agent when main has no branch checked out at all", () => {
    expect(isAgentOnBranch(record({ base_branch: "feature-x" }), null)).toBe(true);
  });

  // The agent's own `agent/<id>` branch is never what main has out, so comparing it would hide all.
  it("compares the base branch, not the agent's own working branch", () => {
    expect(isAgentOnBranch(record({ branch: "agent/refund-flow", base_branch: "main" }), "main"))
      .toBe(true);
  });
});
