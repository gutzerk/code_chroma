import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord, CanonicalAgentStatus, WorktreeRecord } from "../state/types";
import type { AgentClient } from "./agentClient";
import { attentionBody, notifyAgentStatus } from "./agentNotifications";
import { currentEffectiveStatuses, isLookingAtAgent, viewedAgentId } from "./agentAttention";
import { answerPermission, markSeen, nextBlockedAgent, openAgent } from "./agentFocus";
import { agentStore } from "./agentStore";
import {
  getDesktopWorkspaceApi,
  type AgentCommand,
  type AgentSummaryMessage,
} from "./desktopWorkspaceApi";
import { rollup, type AttentionStatus } from "./statusRollup";
import { agentToastStore } from "./toasts/toastStore";
import { worktreeStore } from "./worktreeStore";

/** How long store changes settle before the shell hears the new summary. */
export const SUMMARY_DEBOUNCE_MS = 150;

const TOAST_TITLES: Record<AttentionStatus, (title: string) => string> = {
  blocked: (title) => `${title} needs you`,
  error: (title) => `${title} failed`,
  done: (title) => `${title} finished`,
};

/** The page -> shell `agent-summary`: every agent with its effective status, plus the project roll-up. */
export function buildAgentSummary(
  agents: readonly AgentRecord[],
  statuses: ReadonlyMap<string, CanonicalAgentStatus>,
  worktrees: readonly WorktreeRecord[],
): AgentSummaryMessage {
  const names = new Map(worktrees.map((tab) => [tab.id, tab.name]));
  const entries = agents.map((agent) => {
    const status = statuses.get(agent.id) ?? "stopped";
    const worktree = agent.workspace ?? null;
    return {
      id: agent.id,
      title: agent.title,
      status,
      worktree,
      worktree_title: worktree ? (names.get(worktree) ?? null) : null,
      activity: status === "working" ? (agent.activity ?? null) : null,
      pending_permission: agent.pending_permission ?? null,
      status_since: agent.status_since ?? null,
    };
  });
  const { top, count } = rollup(entries.map((entry) => entry.status));
  return { type: "agent-summary", top, count, agents: entries };
}

/** A status change worth interrupting for: a toast and an OS notification, unless the user is looking at that agent. */
export function announceStatus(client: AgentClient, agent: AgentRecord, kind: AttentionStatus): void {
  if (isLookingAtAgent(agent.id)) {
    if (kind === "done") markSeen(client, agent.id);
    return;
  }
  agentToastStore.show({
    agentId: agent.id,
    kind,
    title: TOAST_TITLES[kind](agent.title),
    body: attentionBody(agent, kind),
  });
  notifyAgentStatus(agent, kind, () => openAgent(client, agent.id));
}

/** Runs a shell command: open an agent, or answer its permission request. */
export function handleAgentCommand(client: AgentClient, raw: AgentCommand | string): void {
  const command: AgentCommand = typeof raw === "string" ? (JSON.parse(raw) as AgentCommand) : raw;
  if (command.type === "select-agent") openAgent(client, command.id);
  else if (command.type === "permission") {
    void answerPermission(client, command.id, command.request_id, command.decision);
  }
}

/** True for ⌘⇧J / Ctrl+Shift+J. */
function isNextWaitingKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "j";
}

/** Marks the viewed done agent seen, drops stale toasts, reports the shell summary, runs its commands; returns the teardown. */
export function startAgentStatusSync(client: AgentClient): () => void {
  const desktop = getDesktopWorkspaceApi();
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;

  const reportNow = () => {
    summaryTimer = undefined;
    desktop?.reportAgents?.(
      buildAgentSummary(agentStore.getAgents(), currentEffectiveStatuses(), worktreeStore.getRecords()),
    );
  };

  const onChange = () => {
    const viewed = viewedAgentId();
    if (viewed && isLookingAtAgent(viewed)) markSeen(client, viewed);
    agentToastStore.reconcile(currentEffectiveStatuses());
    if (desktop?.reportAgents) {
      clearTimeout(summaryTimer);
      summaryTimer = setTimeout(reportNow, SUMMARY_DEBOUNCE_MS);
    }
  };

  // Inside the shell its own script owns ⌘⇧J (across every project), so the page only handles it in a plain browser.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isNextWaitingKey(event) || event.isComposing) return;
    const next = nextBlockedAgent();
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    openAgent(client, next.id);
  };

  const unsubscribers = [
    agentStore.subscribe(onChange),
    layoutStore.subscribe(onChange),
    worktreeStore.subscribe(onChange),
    canvasDocStore.subscribe(onChange),
  ];
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  if (!desktop) window.addEventListener("keydown", onKeyDown, true);
  const offCommand = desktop?.onAgentCommand?.((command) => handleAgentCommand(client, command));
  if (desktop?.reportAgents) reportNow();
  onChange();

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("keydown", onKeyDown, true);
    clearTimeout(summaryTimer);
    if (typeof offCommand === "function") offCommand();
  };
}
