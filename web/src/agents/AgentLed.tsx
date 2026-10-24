import { useOpenAgentQuestions } from "../canvas/doc/question/useOpenAgentQuestions";
import { QUESTION_STRINGS as S } from "../canvas/doc/question/questionStrings";
import type { AgentStatus } from "../state/types";

/** Human wording for each status, so the LED's colour is never the only carrier of the meaning. */
const LABELS: Record<AgentStatus, string> = {
  stopped: "Stopped",
  running: "Running",
  exited: "Crashed",
  idle: "Idle",
  blocked: "Blocked",
  working: "Working",
  foreign: "Running something else",
};

/** The one status dot, shared by the panel and the window title bar. The colour map lives in
 * styles.css under `.agent-led-*`, in one place, rather than being duplicated per call site. */
export function AgentLed({ status, agentId }: { status: AgentStatus; agentId: string }) {
  const count = useOpenAgentQuestions(agentId).length;
  const asking = count > 0;
  const label = asking ? `${LABELS[status] ?? status} · ${S.questionCount(count)}` : LABELS[status] ?? status;
  return (
    <>
      <span
        className={`agent-led agent-led-${status}${asking ? " agent-led--asking" : ""}`}
        data-testid={`agent-led-${status}`}
        data-asking={asking || undefined}
        role="img"
        aria-label={label}
        title={label}
      />
      {asking && <span className="agent-led-badge" aria-hidden="true">?</span>}
    </>
  );
}

export function agentStatusLabel(status: AgentStatus): string {
  return LABELS[status] ?? status;
}
