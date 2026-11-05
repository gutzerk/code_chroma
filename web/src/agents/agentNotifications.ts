import type { AgentRecord, AgentStatus } from "../state/types";
import { getDesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { playStatusSound } from "./notificationSound";
import { isAttentionStatus, type AttentionStatus } from "./statusRollup";

/** A `done` toast and OS notification close themselves after this; blocked and error stay. */
export const DONE_AUTO_CLOSE_MS = 6000;

/** The blocked wording every surface shares: a pending permission (followed by its summary), else an open question. */
export const BLOCKED_TEXT = {
  permission: "Asking permission",
  answer: "Waiting for your answer",
} as const;

const TITLES: Record<AttentionStatus, (title: string) => string> = {
  blocked: (title) => `${title} needs you`,
  error: (title) => `${title} failed`,
  done: (title) => `${title} finished`,
};

/** The toast and notification headline: "<agent> needs you", "failed" or "finished". */
export function attentionTitle(agent: AgentRecord, kind: AttentionStatus): string {
  return TITLES[kind](agent.title);
}

/** The notification's second line: what the agent asks for, why it failed, or that it is done. */
export function attentionBody(agent: AgentRecord, kind: AttentionStatus): string {
  if (kind === "blocked") {
    const summary = agent.pending_permission?.summary;
    return summary ? `${BLOCKED_TEXT.permission}: ${summary}` : BLOCKED_TEXT.answer;
  }
  if (kind === "error") return agent.error?.message ?? "The agent stopped with an error";
  return "Finished its turn";
}

/** Which transitions interrupt the user: entering blocked, error or done; a missing `previous` is a fresh load. */
export function statusChangeKind(
  previous: AgentStatus | undefined,
  next: AgentStatus,
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

  const notification = new Notification(attentionTitle(agent, kind), {
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
