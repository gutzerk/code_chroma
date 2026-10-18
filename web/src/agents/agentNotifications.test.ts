import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord, AgentStatus } from "../state/types";
import {
  ensureNotificationPermission,
  isAgentWindowFocused,
  notifyAgentStatus,
  statusChangeKind,
} from "./agentNotifications";
import { agentStore } from "./agentStore";

vi.mock("./notificationSound", () => ({ playStatusSound: vi.fn() }));
vi.mock("./desktopWorkspaceApi", () => ({ getDesktopWorkspaceApi: vi.fn(() => undefined) }));

import { getDesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { playStatusSound } from "./notificationSound";

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
    pid: 4242,
    window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
    status: "working",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

describe("statusChangeKind", () => {
  it("returns null when the agent has no previous status (just added to the list)", () => {
    expect(statusChangeKind(undefined, "blocked")).toBeNull();
  });

  it("returns null when the status did not actually change", () => {
    expect(statusChangeKind("working", "working")).toBeNull();
  });

  it("fires 'blocked' whenever the agent enters blocked", () => {
    expect(statusChangeKind("working", "blocked")).toBe("blocked");
    expect(statusChangeKind("idle", "blocked")).toBe("blocked");
  });

  it("fires 'idle' only when idle follows working, not e.g. a fresh stopped agent", () => {
    expect(statusChangeKind("working", "idle")).toBe("idle");
    expect(statusChangeKind("stopped", "idle")).toBeNull();
  });

  it("fires 'exited' on any transition into exited", () => {
    expect(statusChangeKind("working", "exited")).toBe("exited");
  });

  it("stays silent for transitions that aren't actionable", () => {
    const silent: [AgentStatus, AgentStatus][] = [
      ["idle", "working"],
      ["working", "foreign"],
      ["foreign", "working"],
    ];
    for (const [previous, next] of silent) {
      expect(statusChangeKind(previous, next)).toBeNull();
    }
  });
});

describe("isAgentWindowFocused", () => {
  beforeEach(() => {
    agentStore.reset();
  });

  it("is false when the window is minimized", () => {
    const agent = record({ window: { x: 0, y: 0, width: 1, height: 1, minimized: true, z: 5 } });
    agentStore.upsert(agent);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    expect(isAgentWindowFocused(agent)).toBe(false);
  });

  it("is false when the document itself is not focused", () => {
    const agent = record();
    agentStore.upsert(agent);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    expect(isAgentWindowFocused(agent)).toBe(false);
  });

  it("is false when another agent's window is on top", () => {
    const agent = record({ window: { x: 0, y: 0, width: 1, height: 1, minimized: false, z: 1 } });
    const other = record({
      id: "other",
      window: { x: 0, y: 0, width: 1, height: 1, minimized: false, z: 2 },
    });
    agentStore.upsert(agent);
    agentStore.upsert(other);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    expect(isAgentWindowFocused(agent)).toBe(false);
  });

  it("is true when the agent's window is the topmost, unminimized one and the page has focus", () => {
    const agent = record({ window: { x: 0, y: 0, width: 1, height: 1, minimized: false, z: 3 } });
    agentStore.upsert(agent);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    expect(isAgentWindowFocused(agent)).toBe(true);
  });
});

describe("ensureNotificationPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests permission when it has never been decided", () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });

    ensureNotificationPermission();

    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not re-prompt once permission is already decided", () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });

    ensureNotificationPermission();

    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("notifyAgentStatus", () => {
  beforeEach(() => {
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(window, "focus").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("always plays the tone, even when notifications are unavailable", () => {
    vi.stubGlobal("Notification", undefined);

    notifyAgentStatus(record(), "idle", vi.fn());

    expect(playStatusSound).toHaveBeenCalledWith("idle");
  });

  it("skips the desktop notification when permission was never granted", () => {
    FakeNotification.permission = "default";

    notifyAgentStatus(record(), "blocked", vi.fn());

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("shows a titled notification naming the agent when permission is granted", () => {
    notifyAgentStatus(record({ title: "refund flow" }), "blocked", vi.fn());

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe("refund flow needs you");
  });

  it("self-closes the notification after 5 seconds", () => {
    notifyAgentStatus(record(), "idle", vi.fn());
    const notification = FakeNotification.instances[0];

    vi.advanceTimersByTime(5000);

    expect(notification.close).toHaveBeenCalledTimes(1);
  });

  it("focuses the desktop tab and opens the agent window when the notification is clicked", () => {
    const focusThisTab = vi.fn(async () => {});
    vi.mocked(getDesktopWorkspaceApi).mockReturnValue({
      openWorkspaceWindow: vi.fn(),
      closeWorkspaceWindow: vi.fn(),
      focusThisTab,
      closeThisProject: vi.fn(async () => {}),
    });
    const onOpen = vi.fn();
    notifyAgentStatus(record(), "exited", onOpen);
    const notification = FakeNotification.instances[0];

    notification.onclick?.();

    expect(focusThisTab).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });
});
