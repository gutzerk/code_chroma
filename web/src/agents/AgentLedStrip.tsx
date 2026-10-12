import type { AgentRecord } from "../state/types";
import { AgentLed } from "./AgentLed";

/** The collapsed form of an agent panel: one status LED per agent in a column; click picks that agent. */
export function AgentLedStrip({
  agents,
  onSelect,
  onBackgroundClick,
  framed = false,
  testId = "agent-led-strip",
}: {
  agents: readonly AgentRecord[];
  onSelect: (agent: AgentRecord) => void;
  /** Makes the strip's empty space clickable too, so the whole collapsed panel opens it. */
  onBackgroundClick?: () => void;
  framed?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`agent-led-strip${framed ? " agent-led-strip--framed" : ""}${onBackgroundClick ? " agent-led-strip--clickable" : ""}`}
      data-testid={testId}
      onClick={onBackgroundClick}
    >
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className="agent-led-strip-button"
          aria-label={`Open ${agent.title}`}
          data-testid={`${testId}-${agent.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(agent);
          }}
        >
          <AgentLed status={agent.status} />
        </button>
      ))}
    </div>
  );
}
