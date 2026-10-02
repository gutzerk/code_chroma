import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agentClient";
import type { AgentRecord } from "../state/types";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { launchAgent } from "./launchAgent";
import * as windowActions from "./windowActions";

vi.mock("./windowActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./windowActions")>();
  return {
    ...actual,
    openAgentWindow: vi.fn(actual.openAgentWindow),
    restoreAgentWindow: vi.fn(actual.restoreAgentWindow),
  };
});

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

describe("launchAgent", () => {
  it("creates, starts and opens a fresh agent with no title prompt", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await launchAgent(client(create));

    expect(create).toHaveBeenCalledWith("", "agent", undefined, null);
  });

  it("opens the agent window rather than restoring/switching workspace after creation", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await launchAgent(client(create));

    expect(windowActions.openAgentWindow).toHaveBeenCalledWith(expect.anything(), "helper");
    expect(windowActions.restoreAgentWindow).not.toHaveBeenCalled();
  });

  it("passes the current-view context description through to create", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await launchAgent(client(create), undefined, {
      workspace: "main",
      description: "the AI brief for epic \"EP-A-01\" (id EP-A-01); its source lives at plan/epics/EP-A-01.md",
    });

    expect(create).toHaveBeenCalledWith("", "agent", undefined, expect.stringContaining("EP-A-01"));
  });

  it("prefers an actionable task over the view context, tagged as context_kind 'task'", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await launchAgent(
      client(create),
      undefined,
      { workspace: "main", description: "the C1 diagram" },
      "What would you like to draw?",
    );

    expect(create).toHaveBeenCalledWith(
      "", "agent", undefined, "What would you like to draw?", "task",
    );
  });

  it("does nothing once the agent limit is reached", async () => {
    for (let index = 0; index < 5; index += 1) agentStore.upsert(agentRecord(`agent-${index}`));
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));

    await launchAgent(client(create));

    expect(create).not.toHaveBeenCalled();
  });

  it("stops and publishes the preflight when the repo isn't ready", async () => {
    const create = vi.fn(async (title: string) => agentRecord(title || "helper"));
    const blocked = client(create);
    blocked.gitPreflight = async () => ({ state: "no-git", root: "/repo" });

    await launchAgent(blocked);

    expect(create).not.toHaveBeenCalled();
    expect(agentStore.getGitPreflight()).toEqual({ state: "no-git", root: "/repo" });
  });

  it("ignores a second call while the first launch is still in flight", async () => {
    let resolveCreate: (record: AgentRecord) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<AgentRecord>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const shared = client(create);

    const first = launchAgent(shared);
    const second = launchAgent(shared);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    resolveCreate(agentRecord("helper"));
    await Promise.all([first, second]);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
