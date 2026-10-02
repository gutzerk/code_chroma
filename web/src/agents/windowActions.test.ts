import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agentClient";
import type { AgentRecord } from "../state/types";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { workspaceStore } from "./workspaceStore";
import {
  closeAgentWindow,
  confirmCloseAgentWindow,
  minimizeAgentWindow,
  openAgentWindow,
  restoreAgentWindow,
} from "./windowActions";

function client(activateWorkspace = vi.fn(async (id: string) => ({
  id,
  state: "ready" as const,
  progress: "",
  error: null,
}))): AgentClient & { activateWorkspace: typeof activateWorkspace } {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => {
      throw new Error("not used");
    },
    start: async () => {
      throw new Error("not used");
    },
    stop: async () => {
      throw new Error("not used");
    },
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "GitHub CLI required", dirty: [] }),
    createPr: async () => {
      throw new Error("not used");
    },
    recreateWorktree: async () => {
      throw new Error("not used");
    },
    activateWorkspace,
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
  };
}

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

beforeEach(() => {
  agentStore.reset();
  workspaceStore.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("restoreAgentWindow", () => {
  it("makes the restored agent's workspace the active one, since opening it is why you'd want the canvas to follow", async () => {
    const activateWorkspace = vi.fn(async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }));

    restoreAgentWindow(client(activateWorkspace), "refund-flow");
    await Promise.resolve();

    expect(activateWorkspace).toHaveBeenCalledWith("refund-flow");
    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });

  it("publishes the returned status, same as the panel's explicit Make active button", async () => {
    restoreAgentWindow(client(), "refund-flow");
    await Promise.resolve();

    expect(workspaceStore.getStatus("refund-flow")).toEqual({
      id: "refund-flow",
      state: "ready",
      progress: "",
      error: null,
    });
  });

  it("skips the switch entirely when the agent is already the active workspace", async () => {
    const activateWorkspace = vi.fn(async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }));
    agentStore.setActiveWorkspace("refund-flow");

    restoreAgentWindow(client(activateWorkspace), "refund-flow");
    await Promise.resolve();

    expect(activateWorkspace).not.toHaveBeenCalled();
  });

  it("does not re-activate a workspace the agent shares, so view state like the epic focus survives", async () => {
    const activateWorkspace = vi.fn(async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }));
    // An "Add agent here" agent shares main's worktree — restoring it must not trip the
    // workspace-scoped store reset that would wipe the focused epic.
    agentStore.upsert(record({ id: "attached", shares_workspace_with: "main" }));

    restoreAgentWindow(client(activateWorkspace), "attached");
    await Promise.resolve();

    expect(activateWorkspace).not.toHaveBeenCalled();
    expect(agentStore.getActiveWorkspace()).toBe("main");
  });

  it("does not leave the PR a forked agent came from, since reopening it is a child-of-the-PR action", async () => {
    const activateWorkspace = vi.fn(async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }));
    // An "Add agent here" agent forked from a PR has its own worktree and shares nothing with it, so
    // only source_pr says it belongs to the PR — restoring it must still keep the PR on the canvas.
    agentStore.setActiveWorkspace("pr-282");
    agentStore.upsert(record({ id: "forked", source_pr: "pr-282" }));

    restoreAgentWindow(client(activateWorkspace), "forked");
    await Promise.resolve();

    expect(activateWorkspace).not.toHaveBeenCalled();
    expect(agentStore.getActiveWorkspace()).toBe("pr-282");
  });

  it("still switches for an agent with its own worktree, whose data the canvas is not drawing", async () => {
    const activateWorkspace = vi.fn(async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }));
    agentStore.upsert(record({ id: "own-tree" }));

    restoreAgentWindow(client(activateWorkspace), "own-tree");
    await Promise.resolve();

    expect(activateWorkspace).toHaveBeenCalledWith("own-tree");
    expect(agentStore.getActiveWorkspace()).toBe("own-tree");
  });

  it("surfaces a failed activation instead of leaving the canvas stuck with no explanation", async () => {
    const activateWorkspace = vi.fn(async () => {
      throw new Error("worktree missing");
    });

    restoreAgentWindow(client(activateWorkspace), "refund-flow");
    await Promise.resolve();
    await Promise.resolve();

    expect(agentStore.getLaunchError()).toBe("worktree missing");
  });
});

describe("openAgentWindow", () => {
  it("unminimizes and raises the window without touching the active workspace", () => {
    agentStore.setActiveWorkspace("refund-flow");

    openAgentWindow(client(), "helper");

    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });
});

describe("closeAgentWindow", () => {
  it("opens the confirm dialog when closing the last agent on its own worktree would orphan the directory", async () => {
    const remove = vi.fn(async () => {});
    agentStore.upsert(record());

    closeAgentWindow({ ...client(), remove }, "refund-flow");
    await Promise.resolve();

    expect(agentStore.getPendingClose()).toBe("refund-flow");
    expect(remove).not.toHaveBeenCalled();
  });

  it("closes immediately, no dialog, for an agent that shares its worktree with another", async () => {
    const remove = vi.fn(async () => {});
    // Two agents on the same worktree — neither is the last one, so "×" must not offer a delete.
    agentStore.upsert(record({ id: "a", worktree: "/wt/shared" }));
    agentStore.upsert(record({ id: "b", worktree: "/wt/shared" }));

    closeAgentWindow({ ...client(), remove }, "a");
    await Promise.resolve();

    expect(agentStore.getPendingClose()).toBeNull();
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("closes immediately, no dialog, for an agent attached to main (shares its worktree)", async () => {
    const remove = vi.fn(async () => {});
    agentStore.upsert(record({ id: "attached", shares_workspace_with: "main" }));

    closeAgentWindow({ ...client(), remove }, "attached");
    await Promise.resolve();

    expect(agentStore.getPendingClose()).toBeNull();
    expect(remove).toHaveBeenCalledWith("attached");
  });

  it("closes immediately, no dialog, when the worktree is already gone", async () => {
    const remove = vi.fn(async () => {});
    agentStore.upsert(record({ worktree_lost: true }));

    closeAgentWindow({ ...client(), remove }, "refund-flow");
    await Promise.resolve();

    expect(agentStore.getPendingClose()).toBeNull();
    expect(remove).toHaveBeenCalledWith("refund-flow");
  });
});

describe("confirmCloseAgentWindow", () => {
  it("removes the card and clears the pending close, keeping the worktree when the checkbox is off", async () => {
    const remove = vi.fn(async () => {});
    agentStore.setPendingClose("refund-flow");

    await confirmCloseAgentWindow({ ...client(), remove }, "refund-flow", false);

    expect(remove).toHaveBeenCalledWith("refund-flow", {});
    expect(agentStore.getPendingClose()).toBeNull();
  });

  it("passes the worktree flag to the bridge when the checkbox is on", async () => {
    const remove = vi.fn(async () => {});
    agentStore.setPendingClose("refund-flow");

    await confirmCloseAgentWindow({ ...client(), remove }, "refund-flow", true);

    expect(remove.mock.calls).toEqual([["refund-flow", { worktree: true }]]);
    expect(agentStore.getPendingClose()).toBeNull();
  });

  it("rejects on a failed delete, leaving the pending close set so the dialog stays open", async () => {
    const remove = vi.fn(async () => {
      throw new Error("worktree is dirty");
    });
    agentStore.setPendingClose("refund-flow");

    await expect(confirmCloseAgentWindow({ ...client(), remove }, "refund-flow", true)).rejects.toThrow(
      "worktree is dirty",
    );
    expect(agentStore.getPendingClose()).toBe("refund-flow");
  });
});

describe("minimizeAgentWindow", () => {
  it("never touches the active workspace — minimizing is a view toggle, not a session or canvas action", () => {
    agentStore.setActiveWorkspace("refund-flow");

    minimizeAgentWindow(client(), "refund-flow");

    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });
});
