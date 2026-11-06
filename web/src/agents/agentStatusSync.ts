import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord, AgentStatus, WorktreeRecord } from "../state/types";
import type { AgentClient } from "./agentClient";
import { attentionBody, attentionTitle, notifyAgentStatus, statusChangeKind } from "./agentNotifications";
import { currentEffectiveStatuses, isLookingAtAgent, viewedAgentId } from "./agentAttention";
import { answerPermission, markSeen, nextBlockedAgent, openAgent } from "./agentFocus";
import { agentStore, openQuestionCount } from "./agentStore";
import {
  getDesktopWorkspaceApi,
  type AgentCommand,
  type AgentSummaryMessage,
} from "./desktopWorkspaceApi";
import { effectiveStatus, type AttentionStatus } from "./statusRollup";
import { agentToastStore } from "./toasts/toastStore";
import { worktreeStore } from "./worktreeStore";

/** How long store changes settle before the shell hears the new summary. */
export const SUMMARY_DEBOUNCE_MS = 150;

/** The page -> shell `agent-summary`: every agent with its effective status; the shell rolls it up itself. */
export function buildAgentSummary(
  agents: readonly AgentRecord[],
  statuses: ReadonlyMap<string, AgentStatus>,
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
  return { type: "agent-summary", agents: entries };
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
    title: attentionTitle(agent, kind),
    body: attentionBody(agent, kind),
  });
  notifyAgentStatus(agent, kind, () => openAgent(client, agent.id));
}

/** Runs a shell command: open an agent, or answer its permission request. */
export function handleAgentCommand(client: AgentClient, command: AgentCommand): void {
  if (command.type === "select-agent") openAgent(client, command.id);
  else if (command.type === "permission") {
    void answerPermission(client, command.id, command.request_id, command.decision);
  }
}

/** One agent's bridge status and the status the user sees (open ask_user questions included). */
export interface StatusSnapshot {
  raw: AgentStatus;
  effective: AgentStatus;
}

/** Every agent's raw and effective status right now. */
function statusSnapshot(): Map<string, StatusSnapshot> {
  return new Map(
    agentStore.getAgents().map((agent) => [
      agent.id,
      { raw: agent.status, effective: effectiveStatus(agent, openQuestionCount(agent)) },
    ]),
  );
}

/** The effective transitions worth announcing; a question closing on its own never announces what lies beneath it. */
export function statusAnnouncements(
  before: ReadonlyMap<string, StatusSnapshot>,
  after: ReadonlyMap<string, StatusSnapshot>,
): [string, AttentionStatus][] {
  const announcements: [string, AttentionStatus][] = [];
  after.forEach((next, id) => {
    const previous = before.get(id);
    if (!previous) return;
    const kind = statusChangeKind(previous.effective, next.effective);
    if (kind && (kind === "blocked" || next.raw !== previous.raw)) announcements.push([id, kind]);
  });
  return announcements;
}

/** True for ⌘⇧J / Ctrl+Shift+J. */
function isNextWaitingKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "j";
}

/** True when the key goes to an embedded terminal, which owns every chord typed into it. */
function isInTerminal(event: KeyboardEvent): boolean {
  return event.target instanceof Element && event.target.closest(".xterm") !== null;
}

/** Everything the sync reads from the stores; an emit that changes none of it is skipped. */
function syncInputs(): readonly unknown[] {
  const { agentsMode, selectedAgentId } = layoutStore.getState();
  return [
    agentStore.getAgents(),
    worktreeStore.getActiveId(),
    worktreeStore.getRecords(),
    agentsMode,
    selectedAgentId,
  ];
}

/** Announces effective status changes, marks the viewed done agent seen, drops stale toasts, reports the shell summary, runs its commands; returns the teardown. */
export function startAgentStatusSync(client: AgentClient): () => void {
  const desktop = getDesktopWorkspaceApi();
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent: string | null = null;
  let lastInputs: readonly unknown[] = [];
  let lastStatuses = statusSnapshot();

  const reportNow = () => {
    summaryTimer = undefined;
    const summary = buildAgentSummary(agentStore.getAgents(), currentEffectiveStatuses(), worktreeStore.getRecords());
    const json = JSON.stringify(summary);
    if (json === lastSent) return;
    lastSent = json;
    desktop?.reportAgents?.(summary);
  };

  const onChange = () => {
    lastInputs = syncInputs();
    const statuses = statusSnapshot();
    const announcements = statusAnnouncements(lastStatuses, statuses);
    lastStatuses = statuses;
    for (const [id, kind] of announcements) {
      const agent = agentStore.getAgent(id);
      if (agent) announceStatus(client, agent, kind);
    }
    const viewed = viewedAgentId();
    if (viewed && isLookingAtAgent(viewed)) markSeen(client, viewed);
    agentToastStore.reconcile(currentEffectiveStatuses());
    if (desktop?.reportAgents) {
      clearTimeout(summaryTimer);
      summaryTimer = setTimeout(reportNow, SUMMARY_DEBOUNCE_MS);
    }
  };

  const onStoreChange = () => {
    const inputs = syncInputs();
    if (inputs.every((value, index) => value === lastInputs[index])) return;
    onChange();
  };

  // Inside the shell its own script owns ⌘⇧J (across every project), so the page only handles it in a plain browser.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isNextWaitingKey(event) || event.isComposing || isInTerminal(event)) return;
    const next = nextBlockedAgent();
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    openAgent(client, next.id);
  };

  const unsubscribers = [
    agentStore.subscribe(onStoreChange),
    layoutStore.subscribe(onStoreChange),
    worktreeStore.subscribe(onStoreChange),
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
