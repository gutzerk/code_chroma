import type { AgentStatus } from "../state/types";

/** Human wording for each status, so the LED's colour is never the only carrier of the meaning. */
const LABELS: Record<AgentStatus, string> = {
  stopped: "Stopped",
  running: "Running",
  exited: "Crashed",
  idle: "Idle — waiting for you",
  blocked: "Waiting for your answer",
  working: "Working",
  foreign: "Running something else",
};

/** The one status dot, shared by the panel and the window title bar. The colour map lives in
 * styles.css under `.agent-led-*`, in one place, rather than being duplicated per call site. */
export function AgentLed({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`agent-led agent-led-${status}`}
      data-testid={`agent-led-${status}`}
      role="img"
      aria-label={LABELS[status] ?? status}
      title={LABELS[status] ?? status}
    />
  );
}

export function agentStatusLabel(status: AgentStatus): string {
  return LABELS[status] ?? status;
}
