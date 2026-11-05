import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord } from "../../state/types";
import { AgentClientProvider } from "../AgentClientContext";
import type { AgentClient } from "../agentClient";
import { DONE_AUTO_CLOSE_MS } from "../agentNotifications";
import { agentStore } from "../agentStore";
import { PR_CLIENT_STUB } from "../stubAgentClient";
import { AgentToastLayer } from "./AgentToastLayer";
import { agentToastStore } from "./toastStore";

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

function permission(summary: string) {
  return { request_id: "p1", tool: "Bash", summary, at: "2026-11-05T10:00:00Z" };
}

function mount() {
  const client = { ...PR_CLIENT_STUB, permission: vi.fn() } as unknown as AgentClient;
  return render(
    <AgentClientProvider client={client}>
      <button type="button">Before</button>
      <AgentToastLayer />
    </AgentClientProvider>,
  );
}

beforeEach(() => {
  agentStore.reset();
  agentToastStore.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentToastLayer", () => {
  it("keeps its live regions mounted while no toast is shown, with no live roles on cards", () => {
    mount();

    act(() => agentToastStore.show({ agentId: "a1", kind: "blocked", title: "a1 needs you", body: "" }));

    expect(screen.getByTestId("agent-toast-live-assertive")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByTestId("agent-toast-live-polite")).toBeEmptyDOMElement();
    expect(screen.getByTestId("agent-toast-a1")).not.toHaveAttribute("role");
  });

  it("reads the body and Allow label from the live permission request", () => {
    agentStore.upsert(agent("a1", { status: "blocked", pending_permission: permission("rm -rf build") }));
    mount();
    act(() => agentToastStore.show({ agentId: "a1", kind: "blocked", title: "a1 needs you", body: "old" }));

    act(() => agentStore.applyStatus("a1", "blocked", { pending_permission: permission("npm publish") }));

    expect(screen.getByTestId("agent-toast-a1")).toHaveTextContent("Asking permission: npm publish");
    expect(screen.getByRole("button", { name: "Allow a1: npm publish" })).toBeInTheDocument();
  });

  it("pauses a done toast's auto-close while hovered and resumes it after", () => {
    vi.useFakeTimers();
    mount();
    act(() => agentToastStore.show({ agentId: "a1", kind: "done", title: "a1 finished", body: "" }));
    const card = screen.getByTestId("agent-toast-a1");

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(DONE_AUTO_CLOSE_MS * 2));
    const whileHovered = agentToastStore.getToasts().length;
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(DONE_AUTO_CLOSE_MS));

    expect(whileHovered).toBe(1);
    expect(agentToastStore.getToasts()).toEqual([]);
  });

  it("returns focus to where it came from when a focused toast closes", () => {
    mount();
    act(() => agentToastStore.show({ agentId: "a1", kind: "done", title: "a1 finished", body: "" }));
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    const close = screen.getByRole("button", { name: "Close notification" });

    act(() => close.focus());
    act(() => agentToastStore.dismiss("a1"));

    expect(document.activeElement).toBe(before);
  });
});
