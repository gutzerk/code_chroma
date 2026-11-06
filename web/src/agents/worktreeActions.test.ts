import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agentClient";
import type { DesktopWorkspaceApi } from "./desktopWorkspaceApi";
import type { PrWorkspace, WorkspaceStatus } from "../state/types";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { worktreeStore } from "./worktreeStore";
import { workspaceStore } from "./workspaceStore";
import { prStore } from "../pr/prStore";
import { ensureWorktrees, recordShownWorkspace } from "./worktreeActions";

const TAB = { id: "br_wt-1", name: "wt-1", branch: "wt-1", worktree: "/repo/.codechroma/worktrees/wt-1" };

function pr(number: number): PrWorkspace {
  return {
    id: `pr-${number}`,
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "octo",
    state: "OPEN",
    head_ref: "feature",
    head_sha: "abc1234",
    head_repo: "acme/app",
    is_fork: false,
    base_ref: "main",
    worktree: `/repo/.codechroma/worktrees/pr-${number}`,
    imported_at: "2026-11-01T10:00:00Z",
    fetched_at: "2026-11-01T10:00:00Z",
    changed_files: 1,
    additions: 1,
    deletions: 0,
    worktree_lost: false,
  };
}

function ready(id: string): WorkspaceStatus {
  return { id, state: "ready", progress: "", error: null };
}

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    ensureWorktrees: async () => ({ branches: [TAB], active: TAB.id }),
    activateWorkspace: vi.fn(async (id: string) => ready(id)),
    setActiveWorktree: vi.fn(async () => {}),
    ...overrides,
  } as unknown as AgentClient;
}

beforeEach(() => {
  agentStore.reset();
  worktreeStore.reset();
  workspaceStore.reset();
  prStore.reset();
});

afterEach(() => {
  delete window.codechromaDesktop;
});

describe("ensureWorktrees restoring the last-viewed PR review", () => {
  it("reopens the PR the project was showing last time", async () => {
    const api = client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "pr-7" }) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe("pr-7");
    expect(api.activateWorkspace).toHaveBeenCalledWith("pr-7");
    expect(worktreeStore.getActiveId()).toBe(TAB.id);
    expect(workspaceStore.getIsReadOnly("pr-7")).toBe(true);
  });

  it("falls back to the tab when the remembered PR is no longer open", async () => {
    const api = client({ listPrs: async () => ({ prs: [], max_prs: 3, active_workspace: "pr-7" }) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe(TAB.id);
    expect(api.activateWorkspace).not.toHaveBeenCalledWith("pr-7");
  });

  it("falls back to the tab without an error when the PR can no longer be loaded", async () => {
    const api = client({
      listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "pr-7" }),
      activateWorkspace: vi.fn(async (id: string) => {
        if (id === "pr-7") throw new Error("unknown workspace: pr-7");
        return ready(id);
      }),
    });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe(TAB.id);
    expect(agentStore.getLaunchError()).toBeNull();
  });

  it("falls back to the tab when the PR list cannot be read", async () => {
    const api = client({ listPrs: async () => Promise.reject(new Error("offline")) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe(TAB.id);
  });

  it("in the desktop app keeps this window on its tab and reopens the PR in its own tab", async () => {
    const openWorkspaceWindow = vi.fn(async () => {});
    window.codechromaDesktop = { openWorkspaceWindow } as unknown as DesktopWorkspaceApi;
    const api = client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "pr-7" }) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe(TAB.id);
    expect(openWorkspaceWindow).toHaveBeenCalledWith("pr-7");
  });

  it("a window opened on a PR records it as the last-viewed workspace", async () => {
    agentStore.setActiveWorkspace("pr-7");
    const api = client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: TAB.id }) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe("pr-7");
    expect(api.activateWorkspace).toHaveBeenCalledWith("pr-7");
  });

  it("an explicit ?workspace tab wins over the remembered PR and is recorded in its place", async () => {
    agentStore.setActiveWorkspace(TAB.id);
    worktreeStore.setList([TAB], TAB.id);
    const api = client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "pr-7" }) });

    await ensureWorktrees(api);

    expect(agentStore.getActiveWorkspace()).toBe(TAB.id);
    expect(api.activateWorkspace).not.toHaveBeenCalledWith("pr-7");
    expect(api.activateWorkspace).toHaveBeenCalledWith(TAB.id);
  });
});

describe("recordShownWorkspace", () => {
  function bridgeRemembering(initial: string): AgentClient {
    let active = initial;
    return client({
      listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: active }),
      activateWorkspace: vi.fn(async (id: string) => {
        active = id;
        return ready(id);
      }),
    });
  }

  it("re-records the project tab when it is shown again, so a closed desktop PR tab does not reopen", async () => {
    const openWorkspaceWindow = vi.fn(async () => {});
    window.codechromaDesktop = { openWorkspaceWindow } as unknown as DesktopWorkspaceApi;
    const api = bridgeRemembering("pr-7");
    await ensureWorktrees(api);
    const stop = recordShownWorkspace(api);

    window.dispatchEvent(new Event("focus"));
    stop();

    expect(openWorkspaceWindow).toHaveBeenCalledWith("pr-7");
    expect((await api.listPrs()).active_workspace).toBe(TAB.id);
  });

  it("a page reload after the project tab was shown again does not re-front the PR tab", async () => {
    const openWorkspaceWindow = vi.fn(async () => {});
    window.codechromaDesktop = { openWorkspaceWindow } as unknown as DesktopWorkspaceApi;
    const api = bridgeRemembering("pr-7");
    await ensureWorktrees(api);
    const stop = recordShownWorkspace(api);
    window.dispatchEvent(new Event("focus"));
    stop();
    agentStore.reset();
    openWorkspaceWindow.mockClear();

    await ensureWorktrees(api);

    expect(openWorkspaceWindow).not.toHaveBeenCalled();
  });

  it("records once when focus and a visibility change arrive together", () => {
    const api = client();
    agentStore.setActiveWorkspace(TAB.id);
    const stop = recordShownWorkspace(api);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    stop();

    expect(api.activateWorkspace).toHaveBeenCalledTimes(1);
  });

  it("ignores a visibility change to hidden and stops listening once stopped", () => {
    const api = client();
    agentStore.setActiveWorkspace(TAB.id);
    const stop = recordShownWorkspace(api);
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    stop();

    window.dispatchEvent(new Event("focus"));

    expect(api.activateWorkspace).not.toHaveBeenCalled();
  });
});
