import { useEffect } from "react";
import { AgentLed } from "../agents/AgentLed";
import { useAgents } from "../agents/agentStore";
import { AgentHeader } from "./AgentHeader";
import { AgentTerminalBody } from "./AgentTerminalBody";
import { shellStore, useShellState } from "./shellStore";
import "./agentsPanel.css";

/** Full-canvas agents view: every agent as an equal column (a grid from four agents up). */
export function AgentsFullscreen() {
  const agents = useAgents();
  const { agents: shellAgents } = useShellState();
  const full = shellAgents.mode === "full";

  useEffect(() => {
    if (!full) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") shellStore.agentsStepOut();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [full]);

  if (!full) return null;
  const count = Math.max(agents.length, 1);
  const columns = count >= 4 ? Math.ceil(Math.sqrt(count)) : count;

  return (
    <div
      className="agents-fullscreen"
      data-testid="agents-fullscreen"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      <button
        type="button"
        className="agents-fullscreen-back"
        aria-label="Exit full screen agents"
        data-testid="agents-fullscreen-back"
        onClick={shellStore.agentsStepOut}
      >
        ›
      </button>
      {agents.map((agent) => (
        <section key={agent.id} className="agents-fullscreen-column" data-testid={`agents-column-${agent.id}`}>
          <div className="agents-fullscreen-title">
            <AgentLed status={agent.status} />
            <span>{agent.title}</span>
            <AgentHeader agent={agent} />
          </div>
          <AgentTerminalBody agent={agent} />
        </section>
      ))}
    </div>
  );
}
