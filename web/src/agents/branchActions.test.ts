import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentClient } from "./agentClient";
import type { AgentRecord } from "../state/types";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { switchBranch } from "./branchActions";
import { branchStore } from "./branchStore";

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
    window: { x: 100, y: 120, width: 720, height: 480, minimized: true, z: 1 },
    status: "idle",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

function agentClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => record(),
    start: async () => record(),
    stop: async () => record(),
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "no gh", dirty: [] }),
    createPr: async () => ({ ...record(), pr_url: "https://github.com/acme/app/pull/1" }),
    recreateWorktree: async () => record(),
    activateWorkspace: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main", "feature-x"] }),
    updateBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    ...overrides,
  };
}

beforeEach(() => {
  agentStore.reset();
  branchStore.reset();
  branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
});

afterEach(() => {
  agentStore.reset();
  branchStore.reset();
});

describe("switchBranch", () => {
  it("records the bridge's answer as the new current branch", async () => {
    await switchBranch(agentClient(), "feature-x");

    expect(branchStore.getCurrent()).toBe("feature-x");
  });

  // The rail and a notification click both start a checkout now, so the failure cannot live in the
  // switcher's own state -- all three surfaces read the same modal off the store.
  it("puts a refused checkout in the store and leaves the branch alone", async () => {
    const failing = agentClient({
      switchBranch: async () => {
        throw new Error("commit or stash your changes before switching branches");
      },
    });

    const ok = await switchBranch(failing, "feature-x");

    expect(ok).toBe(false);
    expect(branchStore.getError()).toBe("commit or stash your changes before switching branches");
    expect(branchStore.getCurrent()).toBe("main");
  });

  it("hands the canvas back to main when the active agent goes out of scope", async () => {
    agentStore.upsert(record({ id: "elsewhere", base_branch: "main" }));
    agentStore.setActiveWorkspace("elsewhere");

    await switchBranch(agentClient(), "feature-x");

    expect(agentStore.getActiveWorkspace()).toBe("main");
  });

  it("leaves the active workspace alone when its agent stays in scope", async () => {
    agentStore.upsert(record({ id: "elsewhere", base_branch: "feature-x" }));
    agentStore.setActiveWorkspace("elsewhere");

    await switchBranch(agentClient(), "feature-x");

    expect(agentStore.getActiveWorkspace()).toBe("elsewhere");
  });
});
