import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord } from "../state/types";
import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { announceStatus, buildAgentSummary, handleAgentCommand, startAgentStatusSync, SUMMARY_DEBOUNCE_MS } from "./agentStatusSync";
import type { DesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentToastStore, DONE_TOAST_MS } from "./toasts/toastStore";
import { worktreeStore } from "./worktreeStore";

vi.mock("./notificationSound", () => ({ playStatusSound: vi.fn() }));

function agent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: id,
    kind: "claude",
    branch: id,
    worktree: `/w/${id}`,
    workspace: "br_1",
    created_at: "",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 0, y: 0, width: 300, height: 300, minimized: false, z: 1 },
    status: "idle",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    saveWindow: async () => {},
    activateWorkspace: async (id: string) => ({ id, state: "ready" as const, progress: "", error: null }),
    seen: vi.fn(async (id: string) => ({ ...agentStore.getAgent(id)!, status: "idle" as const })),
    permission: vi.fn(async (id: string) => ({ ...agentStore.getAgent(id)!, status: "working" as const, pending_permission: null })),
    ...overrides,
  } as unknown as AgentClient;
}

function keyJ(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "J", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
}

beforeEach(() => {
  agentStore.reset();
  worktreeStore.reset();
  layoutStore.reset();
  agentToastStore.reset();
  worktreeStore.setList([{ id: "br_1", name: "wt-1", branch: "wt-1", worktree: "/w/wt-1" }], "br_1");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  delete window.codechromaDesktop;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("buildAgentSummary", () => {
  it("rolls up the effective statuses and names each agent's worktree", () => {
    const agents = [agent("a1", { status_since: "2026-11-05T10:00:00Z" }), agent("a2"), agent("a3")];
    const statuses = new Map([["a1", "blocked" as const], ["a2", "done" as const], ["a3", "working" as const]]);

    const summary = buildAgentSummary(agents, statuses, worktreeStore.getRecords());

    expect(summary).toMatchObject({ type: "agent-summary", top: "blocked", count: 2 });
    expect(summary.agents[0]).toMatchObject({ id: "a1", status: "blocked", worktree: "br_1", worktree_title: "wt-1", status_since: "2026-11-05T10:00:00Z" });
  });
});

describe("handleAgentCommand", () => {
  it("selects an agent and marks a done one seen", async () => {
    const c = client();
    agentStore.upsert(agent("a1", { status: "done" }));

    handleAgentCommand(c, { type: "select-agent", id: "a1" });

    expect(layoutStore.getState().selectedAgentId).toBe("a1");
    await vi.waitFor(() => expect(agentStore.getAgent("a1")?.status).toBe("idle"));
  });

  it("answers a permission request", async () => {
    const c = client();
    agentStore.upsert(agent("a1", { status: "blocked" }));

    handleAgentCommand(c, JSON.stringify({ type: "permission", id: "a1", request_id: "p1", decision: "allow" }));

    await vi.waitFor(() => expect(c.permission).toHaveBeenCalledWith("a1", "p1", "allow"));
  });
});

describe("announceStatus", () => {
  it("toasts an agent the user is not looking at, and a done toast leaves after 6 s", () => {
    vi.useFakeTimers();
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("a2", { status: "done" }));
    layoutStore.selectAgent("a1");

    announceStatus(client(), agentStore.getAgent("a2")!, "done");
    const shown = agentToastStore.getToasts().map((t) => t.agentId);
    vi.advanceTimersByTime(DONE_TOAST_MS);

    expect(shown).toEqual(["a2"]);
    expect(agentToastStore.getToasts()).toEqual([]);
  });

  it("stays quiet about the agent on screen", () => {
    agentStore.upsert(agent("a1", { status: "blocked" }));
    layoutStore.selectAgent("a1");

    announceStatus(client(), agentStore.getAgent("a1")!, "blocked");

    expect(agentToastStore.getToasts()).toEqual([]);
  });
});

describe("startAgentStatusSync", () => {
  it("drops a blocked toast once the agent is answered", () => {
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("a2", { status: "blocked" }));
    layoutStore.selectAgent("a1");
    const stop = startAgentStatusSync(client());
    announceStatus(client(), agentStore.getAgent("a2")!, "blocked");

    agentStore.setStatus("a2", "working");
    stop();

    expect(agentToastStore.getToasts()).toEqual([]);
  });

  it("cycles blocked agents oldest-first on Ctrl+Shift+J in a browser", () => {
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("new", { status: "blocked", status_since: "2026-11-05T10:05:00Z" }));
    agentStore.upsert(agent("old", { status: "blocked", status_since: "2026-11-05T10:00:00Z" }));
    layoutStore.selectAgent("a1");
    const stop = startAgentStatusSync(client());

    window.dispatchEvent(keyJ());
    const first = layoutStore.getState().selectedAgentId;
    window.dispatchEvent(keyJ());
    stop();

    expect([first, layoutStore.getState().selectedAgentId]).toEqual(["old", "new"]);
  });

  it("leaves Ctrl+Shift+J to the desktop shell and reports the summary there", () => {
    vi.useFakeTimers();
    const reportAgents = vi.fn();
    window.codechromaDesktop = { reportAgents } as unknown as DesktopWorkspaceApi;
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("old", { status: "blocked" }));
    layoutStore.selectAgent("a1");
    const stop = startAgentStatusSync(client());

    window.dispatchEvent(keyJ());
    vi.advanceTimersByTime(SUMMARY_DEBOUNCE_MS);
    stop();

    expect(layoutStore.getState().selectedAgentId).toBe("a1");
    expect(reportAgents).toHaveBeenLastCalledWith(expect.objectContaining({ top: "blocked", count: 1 }));
  });
});
