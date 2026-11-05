import type { AgentRecord, AgentStatus, CanonicalAgentStatus } from "../state/types";

/** The statuses that ask for the user's attention; their agents make up a tab's badge count. */
export type AttentionStatus = "blocked" | "error" | "done";

/** What a tab or project shows: the most urgent status, or null when everything is idle or stopped. */
export type RollupTop = AttentionStatus | "working" | null;

export interface StatusRollup {
  top: RollupTop;
  /** Agents in blocked + error + done. */
  count: number;
}

/** Human wording for each status, so the indicator's colour and shape are never the only carriers. */
export const STATUS_LABELS: Record<CanonicalAgentStatus, string> = {
  blocked: "Needs you",
  error: "Error",
  done: "Done",
  working: "Working",
  idle: "Idle",
  stopped: "Stopped",
};

/** The wording for a status, legacy wire values included. */
export function agentStatusLabel(status: AgentStatus): string {
  return STATUS_LABELS[normalizeAgentStatus(status)];
}

/** blocked > error > done > working > idle; stopped never takes part in a roll-up. */
const PRIORITY: Record<CanonicalAgentStatus, number> = {
  blocked: 5,
  error: 4,
  done: 3,
  working: 2,
  idle: 1,
  stopped: 0,
};

const ATTENTION: ReadonlySet<CanonicalAgentStatus> = new Set(["blocked", "error", "done"]);

/** Higher is more urgent. */
export function statusPriority(status: CanonicalAgentStatus): number {
  return PRIORITY[status];
}

export function isAttentionStatus(status: CanonicalAgentStatus): status is AttentionStatus {
  return ATTENTION.has(status);
}

/** Maps the legacy wire values onto the canonical six: a non-zero exit is an `error`, a clean one `stopped`. */
export function normalizeAgentStatus(status: AgentStatus, exitCode: number | null = null): CanonicalAgentStatus {
  switch (status) {
    case "running":
    case "foreign":
      return "idle";
    case "exited":
      return exitCode ? "error" : "stopped";
    default:
      return status;
  }
}

/** An open ask_user question makes a live agent `blocked`, whatever its screen says. */
export function effectiveStatus(
  agent: Pick<AgentRecord, "status" | "exit_code">,
  openQuestions: number,
): CanonicalAgentStatus {
  const status = normalizeAgentStatus(agent.status, agent.exit_code);
  if (openQuestions > 0 && status !== "stopped" && status !== "error") return "blocked";
  return status;
}

/** Most urgent status plus the attention count; `hideDone` drops `done` (the tab the user is already on). */
export function rollup(
  statuses: readonly CanonicalAgentStatus[],
  options: { hideDone?: boolean } = {},
): StatusRollup {
  let top: CanonicalAgentStatus = "stopped";
  let count = 0;
  for (const status of statuses) {
    if (options.hideDone && status === "done") continue;
    if (isAttentionStatus(status)) count += 1;
    if (PRIORITY[status] > PRIORITY[top]) top = status;
  }
  return { top: top === "idle" || top === "stopped" ? null : top, count };
}
