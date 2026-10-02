import type { AgentRecord, AgentStatus } from "../state/types";
import { agentStore } from "./agentStore";
import { getDesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { playStatusSound, type StatusSoundKind } from "./notificationSound";

const AUTO_CLOSE_MS = 5000;

const TITLES: Record<StatusSoundKind, (agent: AgentRecord) => string> = {
  blocked: (agent) => `${agent.title} needs you`,
  idle: (agent) => `${agent.title} finished`,
  exited: (agent) => `${agent.title} crashed`,
};

const BODIES: Record<StatusSoundKind, string> = {
  blocked: "Waiting for your answer",
  idle: "Agent is idle",
  exited: "Agent process exited",
};

/** Which status transitions are worth interrupting the user for -- mirrors Telegram only pinging on
 * a new message, not every presence change. `working` -> `foreign` -> `working` and the like stay
 * silent; a missing `previous` means the agent just entered the list (e.g. on load), not a real
 * transition. */
export function statusChangeKind(
  previous: AgentStatus | undefined,
  next: AgentStatus,
): StatusSoundKind | null {
  if (previous === undefined || previous === next) return null;
  if (next === "blocked") return "blocked";
  if (next === "idle" && previous === "working") return "idle";
  if (next === "exited") return "exited";
  return null;
}

/** True when `agent`'s window is the one on top and the page itself has the user's attention -- the
 * "you're already looking at it" case that should stay silent, the way an already-open chat does. */
export function isAgentWindowFocused(agent: AgentRecord): boolean {
  if (typeof document === "undefined") return false;
  if (agent.window.minimized) return false;
  if (!document.hasFocus() || document.visibilityState !== "visible") return false;
  const topZ = agentStore
    .getAgents()
    .filter((candidate) => !candidate.window.minimized)
    .reduce((highest, candidate) => Math.max(highest, candidate.window.z), Number.NEGATIVE_INFINITY);
  return agent.window.z === topZ;
}

/** Requests notification permission once; safe to call on every mount -- browsers only ever prompt
 * on the first `"default"` call and no-op silently afterward. */
export function ensureNotificationPermission(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/**
 * Plays `kind`'s tone and, permission allowing, raises a desktop notification for `agent` that
 * self-closes after 5 seconds. Clicking it brings the right OS window/tab to front (a no-op outside
 * the desktop app) and then runs `onOpen`, which the caller uses to restore and raise the agent's own
 * window.
 */
export function notifyAgentStatus(
  agent: AgentRecord,
  kind: StatusSoundKind,
  onOpen: () => void,
): void {
  playStatusSound(kind);

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const notification = new Notification(TITLES[kind](agent), {
    body: BODIES[kind],
    tag: agent.id,
    silent: true,
  });
  const closeTimer = setTimeout(() => notification.close(), AUTO_CLOSE_MS);
  notification.onclick = () => {
    clearTimeout(closeTimer);
    notification.close();
    window.focus();
    void getDesktopWorkspaceApi()?.focusThisTab();
    onOpen();
  };
}
