import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord, AgentStatus } from "../state/types";
import {
  attentionBody,
  ensureNotificationPermission,
  notifyAgentStatus,
  statusChangeKind,
  wantsOsNotification,
} from "./agentNotifications";
import type { AttentionStatus } from "./statusRollup";

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
    expect(statusChangeKind("blocked", "blocked")).toBeNull();
  });

  it.each<AgentStatus>(["blocked", "error", "done"])("fires on entering %s", (next) => {
    expect(statusChangeKind("working", next)).toBe(next);
  });

  it.each<[AgentStatus, AgentStatus]>([
    ["idle", "working"],
    ["working", "idle"],
    ["done", "idle"],
    ["error", "stopped"],
  ])("stays silent for %s -> %s", (previous, next) => {
    expect(statusChangeKind(previous, next)).toBeNull();
  });
});

describe("wantsOsNotification", () => {
  it.each<[AttentionStatus, boolean, boolean]>([
    ["blocked", true, true],
    ["error", true, true],
    ["done", true, false],
    ["done", false, true],
  ])("%s with page focus %s -> %s", (kind, focused, expected) => {
    expect(wantsOsNotification(kind, focused)).toBe(expected);
  });
});

describe("attentionBody", () => {
  it("names the permission a blocked agent asks for", () => {
    const agent = record({
      pending_permission: { request_id: "p1", tool: "Bash", summary: "Bash(npm run e2e)", at: "" },
    });

    expect(attentionBody(agent, "blocked")).toBe("Asking permission: Bash(npm run e2e)");
  });

  it("carries the error message", () => {
    expect(attentionBody(record({ error: { message: "claude exited with code 1", at: "" } }), "error")).toBe(
      "claude exited with code 1",
    );
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
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("plays the tone for blocked, even when notifications are unavailable", () => {
    vi.stubGlobal("Notification", undefined);

    notifyAgentStatus(record(), "blocked", vi.fn());

    expect(playStatusSound).toHaveBeenCalledWith("blocked");
  });

  it.each(["error", "done"] as const)("stays silent for %s", (kind) => {
    notifyAgentStatus(record(), kind, vi.fn());

    expect(playStatusSound).not.toHaveBeenCalled();
  });

  it("skips the desktop notification when permission was never granted", () => {
    FakeNotification.permission = "default";

    notifyAgentStatus(record(), "blocked", vi.fn());

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("shows a titled notification naming the agent when permission is granted", () => {
    notifyAgentStatus(record({ title: "refund flow" }), "blocked", vi.fn());

    expect(FakeNotification.instances.map((n) => n.title)).toEqual(["refund flow needs you"]);
  });

  it("skips a done notification while the page has focus", () => {
    notifyAgentStatus(record(), "done", vi.fn());

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("self-closes a background done notification after 6 seconds", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    notifyAgentStatus(record(), "done", vi.fn());
    const notification = FakeNotification.instances[0];

    vi.advanceTimersByTime(6000);

    expect(notification.close).toHaveBeenCalledTimes(1);
  });

  it("focuses the desktop tab and opens the agent when the notification is clicked", () => {
    const focusThisTab = vi.fn(async () => {});
    vi.mocked(getDesktopWorkspaceApi).mockReturnValue({
      openWorkspaceWindow: vi.fn(),
      closeWorkspaceWindow: vi.fn(),
      focusThisTab,
      closeThisProject: vi.fn(async () => {}),
    });
    const onOpen = vi.fn();
    notifyAgentStatus(record(), "error", onOpen);
    const notification = FakeNotification.instances[0];

    notification.onclick?.();

    expect(focusThisTab).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });
});
