import { useState } from "react";
import { AgentLed } from "../agents/AgentLed";
import { useAgentClient } from "../agents/AgentClientContext";
import { useAgents } from "../agents/agentStore";
import { selectAgent } from "./selectAgent";
import { shellStore, useShellState } from "./shellStore";
import "./agentsPanel.css";

const MAX_BUTTONS = 5;

/** The slim collapsed form of the agents panel: a1/a2... buttons that reopen the panel on that agent. */
export function AgentsCollapsedStrip() {
  const agents = useAgents();
  const agentClient = useAgentClient();
  const { agents: shellAgents } = useShellState();
  const [menuOpen, setMenuOpen] = useState(false);
  if (shellAgents.mode !== "collapsed") return null;

  const shown = agents.slice(0, MAX_BUTTONS);
  const extra = agents.slice(MAX_BUTTONS);
  const open = (id: string) => {
    setMenuOpen(false);
    selectAgent(agentClient, id);
  };

  return (
    <div className="agents-strip" data-testid="agents-strip">
      {agents.length === 0 && (
        <button
          type="button"
          className="agents-strip-button"
          aria-label="Open agents"
          data-testid="agents-strip-open"
          onClick={() => shellStore.openAgent()}
        >
          ‹
        </button>
      )}
      {shown.map((agent, i) => (
        <button
          key={agent.id}
          type="button"
          className="agents-strip-button"
          aria-label={`Open ${agent.title}`}
          data-testid={`agents-strip-${agent.id}`}
          onClick={() => open(agent.id)}
        >
          a{i + 1}
          <AgentLed status={agent.status} />
        </button>
      ))}
      {extra.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="agents-strip-button"
            aria-label="More agents"
            data-testid="agents-strip-more"
            onClick={() => setMenuOpen((v) => !v)}
          >
            +{extra.length}
          </button>
          {menuOpen && (
            <div className="agents-strip-menu" role="menu">
              {extra.map((agent, i) => (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitem"
                  className="agents-strip-button"
                  aria-label={`Open ${agent.title}`}
                  data-testid={`agents-strip-${agent.id}`}
                  onClick={() => open(agent.id)}
                >
                  a{MAX_BUTTONS + i + 1}
                  <AgentLed status={agent.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
