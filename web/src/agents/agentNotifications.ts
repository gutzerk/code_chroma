import type { AgentRecord, CanonicalAgentStatus } from "../state/types";
import { getDesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { playStatusSound } from "./notificationSound";
import { isAttentionStatus, type AttentionStatus } from "./statusRollup";

/** A `done` OS notification closes itself; blocked and error stay until the OS dismisses them. */
const DONE_AUTO_CLOSE_MS = 6000;

const TITLES: Record<AttentionStatus, (agent: AgentRecord) => string> = {
  blocked: (agent) => `${agent.title} needs you`,
  error: (agent) => `${agent.title} failed`,
  done: (agent) => `${agent.title} finished`,
};

/** The notification's second line: what the agent asks for, why it failed, or that it is done. */
export function attentionBody(agent: AgentRecord, kind: AttentionStatus): string {
  if (kind === "blocked") {
    const summary = agent.pending_permission?.summary;
    return summary ? `Asking permission: ${summary}` : "Waiting for your answer";
  }
  if (kind === "error") return agent.error?.message ?? "The agent stopped with an error";
  return "Finished its turn";
}

/** Which transitions interrupt the user: entering blocked, error or done; a missing `previous` is a fresh load. */
export function statusChangeKind(
  previous: CanonicalAgentStatus | undefined,
  next: CanonicalAgentStatus,
): AttentionStatus | null {
  if (previous === undefined || previous === next) return null;
  return isAttentionStatus(next) ? next : null;
}

/** OS notification rule: blocked and error always, done only while the page is in the background. */
export function wantsOsNotification(kind: AttentionStatus, pageFocused: boolean): boolean {
  return kind !== "done" || !pageFocused;
}

/** Requests notification permission once; browsers only prompt on the first `"default"` call. */
export function ensureNotificationPermission(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** Plays the blocked tone and, when the rule and permission allow, raises an OS notification; a click focuses the tab and runs `onOpen`. */
export function notifyAgentStatus(agent: AgentRecord, kind: AttentionStatus, onOpen: () => void): void {
  if (kind === "blocked") playStatusSound("blocked");
  const pageFocused = typeof document !== "undefined" && document.hasFocus();
  if (!wantsOsNotification(kind, pageFocused)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const notification = new Notification(TITLES[kind](agent), {
    body: attentionBody(agent, kind),
    tag: agent.id,
    silent: true,
  });
  const closeTimer = kind === "done" ? setTimeout(() => notification.close(), DONE_AUTO_CLOSE_MS) : undefined;
  notification.onclick = () => {
    clearTimeout(closeTimer);
    notification.close();
    window.focus();
    void getDesktopWorkspaceApi()?.focusThisTab();
    onOpen();
  };
}
