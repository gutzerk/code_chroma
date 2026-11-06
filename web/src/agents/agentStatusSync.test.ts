import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord, CanvasElement } from "../state/types";
import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { announceStatus, buildAgentSummary, handleAgentCommand, startAgentStatusSync, SUMMARY_DEBOUNCE_MS } from "./agentStatusSync";
import type { DesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { DONE_AUTO_CLOSE_MS } from "./agentNotifications";
import { agentToastStore } from "./toasts/toastStore";
import { worktreeStore } from "./worktreeStore";
import { playStatusSound } from "./notificationSound";

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

function question(id: string, agentId: string): CanvasElement {
  return {
    id,
    render: "question",
    layer: "questions",
    label: "Which way?",
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    group_id: null,
    meta: { state: "open", agent_id: agentId },
    created_by: "ai",
  };
}

function keyJ(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "J", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
}

beforeEach(() => {
  agentStore.reset();
  worktreeStore.reset();
  layoutStore.reset();
  agentToastStore.reset();
  canvasDocStore.reset();
  vi.mocked(playStatusSound).mockClear();
  worktreeStore.setList([{ id: "br_1", name: "wt-1", branch: "wt-1", worktree: "/w/wt-1" }], "br_1");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  delete window.codechromaDesktop;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("buildAgentSummary", () => {
  it("carries the effective statuses and names each agent's worktree", () => {
    const agents = [agent("a1", { status_since: "2026-11-05T10:00:00Z" }), agent("a2"), agent("a3")];
    const statuses = new Map([["a1", "blocked" as const], ["a2", "done" as const], ["a3", "working" as const]]);

    const summary = buildAgentSummary(agents, statuses, worktreeStore.getRecords());

    expect(summary.type).toBe("agent-summary");
    expect(summary.agents.map((entry) => entry.status)).toEqual(["blocked", "done", "working"]);
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

    handleAgentCommand(c, { type: "permission", id: "a1", request_id: "p1", decision: "allow" });

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
    vi.advanceTimersByTime(DONE_AUTO_CLOSE_MS);

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
    expect(reportAgents.mock.lastCall?.[0].agents.map((entry: { status: string }) => entry.status)).toEqual([
      "idle",
      "blocked",
    ]);
  });

  it("announces an agent that asked a question and ended its turn as needing you, not finished", () => {
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("a2", { status: "working" }));
    layoutStore.selectAgent("a1");
    const stop = startAgentStatusSync(client());

    agentStore.setOpenQuestions("a2", 1);
    agentStore.setStatus("a2", "done");
    stop();

    expect(agentToastStore.getToasts().map((t) => [t.agentId, t.kind])).toEqual([["a2", "blocked"]]);
    expect(playStatusSound).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when an answered question uncovers a turn that already ended", () => {
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("a2", { status: "done", open_questions: 1 }));
    layoutStore.selectAgent("a1");
    const stop = startAgentStatusSync(client());

    agentStore.setOpenQuestions("a2", 0);
    stop();

    expect(agentToastStore.getToasts()).toEqual([]);
  });

  it("ignores canvas changes: open question counts come only from the bridge", () => {
    vi.useFakeTimers();
    const reportAgents = vi.fn();
    window.codechromaDesktop = { reportAgents } as unknown as DesktopWorkspaceApi;
    agentStore.upsert(agent("a1"));
    const stop = startAgentStatusSync(client());
    const reconcile = vi.spyOn(agentToastStore, "reconcile");

    canvasDocStore.setDoc({ ...canvasDocStore.getDoc(), elements: { q: question("q", "a1") } });
    vi.advanceTimersByTime(SUMMARY_DEBOUNCE_MS);
    stop();

    expect(reconcile).not.toHaveBeenCalled();
    expect(reportAgents).toHaveBeenCalledTimes(1);
  });

  it("leaves Ctrl+Shift+J to a focused terminal", () => {
    agentStore.upsert(agent("a1"));
    agentStore.upsert(agent("old", { status: "blocked" }));
    layoutStore.selectAgent("a1");
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const input = document.createElement("textarea");
    terminal.appendChild(input);
    document.body.appendChild(terminal);
    const stop = startAgentStatusSync(client());

    input.dispatchEvent(keyJ());
    stop();
    terminal.remove();

    expect(layoutStore.getState().selectedAgentId).toBe("a1");
  });

  it("skips a summary identical to the last one sent", () => {
    vi.useFakeTimers();
    const reportAgents = vi.fn();
    window.codechromaDesktop = { reportAgents } as unknown as DesktopWorkspaceApi;
    agentStore.upsert(agent("a1"));
    const stop = startAgentStatusSync(client());

    agentStore.setWindow("a1", { x: 40 });
    vi.advanceTimersByTime(SUMMARY_DEBOUNCE_MS);
    stop();

    expect(reportAgents).toHaveBeenCalledTimes(1);
  });
});
