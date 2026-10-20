import type { AgentRecord } from "../state/types";
import { agentStatusLabel } from "./AgentLed";
import "./AgentTab.css";

/** One agent as a tab: status dot, name and a mono status line; used by the full-screen agents view. */
export function AgentTab({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`agent-tab${selected ? " agent-tab--selected" : ""}`}
      data-testid={`agent-tab-${agent.id}`}
      onClick={onSelect}
    >
      <span className={`agent-led agent-led-${agent.status}`} aria-hidden="true" />
      <span className="agent-tab-name">{agent.title}</span>
      <span className="agent-tab-meta">{agentStatusLabel(agent.status)}</span>
    </button>
  );
}
