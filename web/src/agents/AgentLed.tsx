import type { AgentStatus } from "../state/types";
import { useAgentStatus } from "./activity/agentStatusText";
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
  const { shown, label } = useAgentStatus(status, agentId);
  return <StatusIndicator status={shown} size={size} label={label} testId={`agent-led-${shown}`} />;
}
