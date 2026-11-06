import type { AgentRecord, AgentStatus } from "../state/types";

/** The statuses that ask for the user's attention; their agents make up a tab's badge count. */
export type AttentionStatus = "blocked" | "error" | "done";

/** What a tab or project shows: the most urgent status, or null when everything is idle or stopped. */
export type RollupTop = AttentionStatus | "working" | null;

export interface StatusRollup {
  top: RollupTop;
  /** Agents in blocked + error + done. */
  count: number;
  /** The same agents split by status. */
  counts: Record<AttentionStatus, number>;
}

/** Human wording for each status, so the indicator's colour and shape are never the only carriers. */
export const STATUS_LABELS: Record<AgentStatus, string> = {
  blocked: "Needs you",
  error: "Error",
  done: "Done",
  working: "Working",
  idle: "Idle",
  stopped: "Stopped",
};

/** blocked > error > done > working > idle; stopped never takes part in a roll-up. */
const PRIORITY: Record<AgentStatus, number> = {
  blocked: 5,
  error: 4,
  done: 3,
  working: 2,
  idle: 1,
  stopped: 0,
};

const ATTENTION: ReadonlySet<AgentStatus> = new Set(["blocked", "error", "done"]);

export function isAttentionStatus(status: AgentStatus): status is AttentionStatus {
  return ATTENTION.has(status);
}

/** Whether prompts and usage are re-read on a timer: only a working agent writes new ones, others re-read on each status change; exhaustive so a status change breaks the build. */
const POLLED: Record<AgentStatus, boolean> = {
  idle: false,
  working: true,
  blocked: false,
  done: false,
  stopped: false,
  error: false,
};

export function isPolledStatus(status: AgentStatus): boolean {
  return POLLED[status];
}

/** Store-boundary guard against an older bridge: `exited` is `error` (non-zero exit) or `stopped`, any other unknown value `idle`. */
export function normalizeAgentStatus(status: string, exitCode: number | null = null): AgentStatus {
  if (status === "exited") return exitCode ? "error" : "stopped";
  return Object.hasOwn(PRIORITY, status) ? (status as AgentStatus) : "idle";
}

/** An open ask_user question makes a live agent `blocked`, whatever its screen says. */
export function effectiveStatus(agent: Pick<AgentRecord, "status">, openQuestions: number): AgentStatus {
  if (openQuestions > 0 && agent.status !== "stopped" && agent.status !== "error") return "blocked";
  return agent.status;
}

/** Most urgent status plus the attention counts; `hideDone` drops `done` (the tab the user is already on). */
export function rollup(statuses: readonly AgentStatus[], options: { hideDone?: boolean } = {}): StatusRollup {
  let top: AgentStatus = "stopped";
  const counts: Record<AttentionStatus, number> = { blocked: 0, error: 0, done: 0 };
  for (const status of statuses) {
    if (options.hideDone && status === "done") continue;
    if (isAttentionStatus(status)) counts[status] += 1;
    if (PRIORITY[status] > PRIORITY[top]) top = status;
  }
  return {
    top: top === "idle" || top === "stopped" ? null : top,
    count: counts.blocked + counts.error + counts.done,
    counts,
  };
}
