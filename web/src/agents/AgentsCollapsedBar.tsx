import { layoutStore } from "../canvas/layout/layoutStore";
import { useAgents } from "./agentStore";
import "./AgentsCollapsedBar.css";

/** The collapsed agents panel: one a1/a2 button per agent in a row at the top right. */
export function AgentsCollapsedBar() {
  const agents = useAgents();
  return (
    <div className="agents-collapsed-bar" data-testid="agents-collapsed-bar">
      {agents.map((agent, index) => (
        <button
          key={agent.id}
          type="button"
          className="agents-collapsed-bar-button"
          aria-label={`Open ${agent.title}`}
          data-testid={`agents-collapsed-bar-${agent.id}`}
          onClick={() => {
            layoutStore.setAgentsMode("normal");
            layoutStore.selectAgent(agent.id);
          }}
        >
          {`a${index + 1}`}
          <span className={`agent-led agent-led-${agent.status} agents-collapsed-bar-dot`} />
        </button>
      ))}
    </div>
  );
}
