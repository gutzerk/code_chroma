import { QUESTION_STRINGS as S } from "../canvas/doc/question/questionStrings";
import type { AgentStatus } from "../state/types";
import { useOpenQuestionCount } from "./agentStore";
import { effectiveStatus, STATUS_LABELS } from "./statusRollup";
import { StatusIndicator } from "./StatusIndicator";

/** One agent's status indicator; an open ask_user question raises it to `blocked`. */
export function AgentLed({
  status,
  agentId,
  size = "dot",
}: {
  status: AgentStatus;
  agentId: string;
  size?: "dot" | "icon";
}) {
  const count = useOpenQuestionCount(agentId);
  const shown = effectiveStatus({ status }, count);
  const label = count > 0 ? `${STATUS_LABELS[shown]} · ${S.questionCount(count)}` : STATUS_LABELS[shown];
  return <StatusIndicator status={shown} size={size} label={label} testId={`agent-led-${shown}`} />;
}
