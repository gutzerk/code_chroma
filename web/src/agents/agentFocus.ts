import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord } from "../state/types";
import type { AgentClient, PermissionDecision } from "./agentClient";
import { agentStore } from "./agentStore";
import { currentEffectiveStatuses, viewedAgentId } from "./agentAttention";
import { agentToastStore } from "./toasts/toastStore";
import { restoreAgentWindow } from "./windowActions";

const seenInFlight = new Set<string>();

/** A click on an agent row: select it (its worktree tab follows) and clear its diagram badge. */
export function selectAgent(client: AgentClient, agent: AgentRecord): void {
  agentStore.clearDiagramsReady(agent.id);
  layoutStore.selectAgent(agent.id);
  restoreAgentWindow(client, agent.id);
}

/** POST /agents/{id}/seen for a `done` agent, once at a time; the reply's `idle` lands in the store. */
export function markSeen(client: AgentClient, id: string): void {
  if (!client.seen || seenInFlight.has(id) || agentStore.getAgent(id)?.status !== "done") return;
  seenInFlight.add(id);
  client
    .seen(id)
    .then(agentStore.upsert)
    .catch(() => {
      // The next look tries again; a stale done badge is better than an error.
    })
    .finally(() => seenInFlight.delete(id));
}

/** Opens `id` the way a click on its row does (worktree tab included), expands the panel and marks it seen. */
export function openAgent(client: AgentClient, id: string): void {
  const agent = agentStore.getAgent(id);
  if (!agent) return;
  if (layoutStore.getState().agentsMode === "collapsed") layoutStore.setAgentsMode("normal");
  selectAgent(client, agent);
  agentToastStore.dismiss(id);
  markSeen(client, id);
}

/** Answers a pending PermissionRequest; the reply replaces the record, a 404 (already answered) is ignored. */
export async function answerPermission(
  client: AgentClient,
  id: string,
  requestId: string,
  decision: PermissionDecision,
): Promise<void> {
  if (!client.permission) return;
  try {
    agentStore.upsert(await client.permission(id, requestId, decision));
  } catch {
    // The terminal answered first, so the request is gone; the next status event says what happened.
  }
}

/** Closes an agent's error (`error` -> `stopped`). */
export async function dismissAgentError(client: AgentClient, id: string): Promise<void> {
  if (!client.dismissError) return;
  agentToastStore.dismiss(id);
  try {
    agentStore.upsert(await client.dismissError(id));
  } catch {
    // The agent may have restarted meanwhile; nothing to undo.
  }
}

/** The blocked agents of this project, longest-waiting first. */
export function blockedAgentsOldestFirst(): AgentRecord[] {
  const statuses = currentEffectiveStatuses();
  return agentStore
    .getAgents()
    .filter((agent) => statuses.get(agent.id) === "blocked")
    .sort((a, b) => (a.status_since ?? "").localeCompare(b.status_since ?? ""));
}

/** ⌘⇧J / Ctrl+Shift+J: the next blocked agent after the one on screen, wrapping around; null when none waits. */
export function nextBlockedAgent(): AgentRecord | null {
  const blocked = blockedAgentsOldestFirst();
  if (blocked.length === 0) return null;
  const at = blocked.findIndex((agent) => agent.id === viewedAgentId());
  return blocked[(at + 1) % blocked.length];
}
