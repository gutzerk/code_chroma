import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agentClient";
import type { AgentRecord } from "../state/types";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { attachAgent } from "./attachAgent";

function agentRecord(id: string): AgentRecord {
  return {
    id,
    title: id,
    kind: "claude",
    branch: `agent/${id}`,
    base_branch: "main",
    worktree: `/tmp/worktrees/${id}`,
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 100, y: 100, width: 720, height: 480, minimized: false, z: 1 },
    status: "stopped",
    exit_code: null,
    worktree_lost: false,
  };
}

function client(create: AgentClient["create"]): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create,
    start: async (id) => ({ ...agentRecord(id), status: "idle" }),
    stop: async () => {
      throw new Error("not used");
    },
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => {
      throw new Error("not used");
    },
    createPr: async () => {
      throw new Error("not used");
    },
    recreateWorktree: async () => {
      throw new Error("not used");
    },
    activateWorkspace: async (id) => ({ id, state: "ready", progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready", progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready", root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
  };
}

beforeEach(() => {
  agentStore.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attachAgent", () => {
  it("passes the currently active workspace as attachTo", async () => {
    agentStore.upsert(agentRecord("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create));

    expect(create).toHaveBeenCalledWith("", "agent", "refund-flow", null);
  });

  it("attaches to main when that is the active workspace", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create));

    expect(create).toHaveBeenCalledWith("", "agent", "main", null);
  });

  it("passes a given task as an actionable context_kind 'task' message instead of context", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create), null, "What would you like to draw?");

    expect(create).toHaveBeenCalledWith(
      "", "agent", "main", "What would you like to draw?", "task",
    );
  });

  it("passes a PR workspace id as attachTo when a PR is the active workspace", async () => {
    agentStore.setActiveWorkspace("pr-282");
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create));

    expect(create).toHaveBeenCalledWith("", "agent", "pr-282", null);
  });

  it("does not switch the active workspace, since the canvas already shows what it attached to", async () => {
    agentStore.upsert(agentRecord("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create));

    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });

  it("still raises the new agent's window even though the workspace doesn't switch", async () => {
    agentStore.upsert(agentRecord("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));
    const target = client(create);
    const saveWindow = vi.fn(async () => {});
    target.saveWindow = saveWindow;

    await attachAgent(target);

    expect(saveWindow).toHaveBeenCalledWith("helper", { minimized: false, z: expect.any(Number) });
  });

  it("does nothing once the agent limit is reached", async () => {
    for (let index = 0; index < 5; index += 1) agentStore.upsert(agentRecord(`agent-${index}`));
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await attachAgent(client(create));

    expect(create).not.toHaveBeenCalled();
  });

  it("stops and publishes the preflight when the repo isn't ready", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));
    const blocked = client(create);
    blocked.gitPreflight = async () => ({ state: "no-git", root: "/repo" });

    await attachAgent(blocked);

    expect(create).not.toHaveBeenCalled();
    expect(agentStore.getGitPreflight()).toEqual({ state: "no-git", root: "/repo" });
  });

  it("launches two independent agents sharing one worktree/branch when called twice in a row", async () => {
    agentStore.upsert(agentRecord("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");
    let nextId = 0;
    const create = vi.fn(async () => {
      nextId += 1;
      return {
        ...agentRecord(`helper-${nextId}`),
        branch: "agent/refund-flow",
        worktree: "/tmp/worktrees/refund-flow",
      };
    });
    const target = client(create);
    target.start = async (id) => ({
      ...agentRecord(id),
      status: "idle",
      branch: "agent/refund-flow",
      worktree: "/tmp/worktrees/refund-flow",
    });

    await attachAgent(target);
    await attachAgent(target);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, "", "agent", "refund-flow", null);
    expect(create).toHaveBeenNthCalledWith(2, "", "agent", "refund-flow", null);
    const [record1, record2] = [agentStore.getAgent("helper-1"), agentStore.getAgent("helper-2")];
    expect(record1?.worktree).toBe(record2?.worktree);
    expect(record1?.branch).toBe(record2?.branch);
    expect(record1?.id).not.toBe(record2?.id);
  });

  it("ignores a second call while the first attach is still in flight", async () => {
    let resolveCreate: (record: AgentRecord) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<AgentRecord>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const shared = client(create);

    const first = attachAgent(shared);
    const second = attachAgent(shared);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    resolveCreate(agentRecord("helper"));
    await Promise.all([first, second]);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
