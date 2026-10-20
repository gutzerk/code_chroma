import { useState } from "react";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { Z_AGENTS, Z_HANDLES } from "../canvas/layout/layoutMetrics";
import { useCurrentViewContext } from "../state/viewContextStore";
import { agentStatusLabel } from "./AgentLed";
import { AgentTab } from "./AgentTab";
import { AgentTerminal } from "./AgentTerminal";
import { useAgentClient } from "./AgentClientContext";
import { attachAgent } from "./attachAgent";
import { useAgents, useIsAtAgentCapacity } from "./agentStore";
import { resolveFullScreenAgentId } from "./useFullScreenAgentId";
import "./AgentFullScreen.css";

/** Full-screen agents view: tabs for every agent, one window for the selected one, edge handle back. */
export function AgentFullScreen() {
  const agentClient = useAgentClient();
  const agents = useAgents();
  const { selectedAgentId } = useLayoutState();
  const fullAgentId = resolveFullScreenAgentId(agents, selectedAgentId);
  const viewContext = useCurrentViewContext();
  const atCapacity = useIsAtAgentCapacity();
  const [draft, setDraft] = useState("");
  const selected = agents.find((agent) => agent.id === fullAgentId);
  const running = selected !== undefined && selected.status !== "stopped" && selected.status !== "exited";

  return (
    <>
      <div className="agent-full" style={{ zIndex: Z_AGENTS }} data-testid="agent-full-screen">
        <div className="agent-full-tabs">
          <div className="agent-full-tablist" role="tablist" aria-label="Agents">
            {agents.map((agent) => (
              <AgentTab
                key={agent.id}
                agent={agent}
                selected={agent.id === selected?.id}
                onSelect={() => layoutStore.selectAgent(agent.id)}
              />
            ))}
          </div>
          <button
            type="button"
            className="agent-full-new"
            aria-label="New agent"
            disabled={atCapacity}
            onClick={() => void attachAgent(agentClient, viewContext)}
          >
            +
          </button>
        </div>
        {selected && (
          <section className="agent-full-window" aria-label={selected.title}>
            <div className="agent-full-transcript">
              <AgentTerminal
                key={selected.id}
                workspace={selected.id}
                running={running}
                kind={selected.kind}
              />
            </div>
            <input
              className="agent-full-input"
              aria-label={`Message ${selected.title}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Message ${selected.title}`}
            />
            <div className="agent-full-status" data-testid="agent-full-status">
              {`${selected.resolved_cli ?? selected.kind} · ${agentStatusLabel(selected.status)} · ${selected.branch}`}
            </div>
          </section>
        )}
      </div>
      <div className="agent-full-handle" style={{ zIndex: Z_HANDLES }}>
        <button
          type="button"
          aria-label="Back to side panel"
          onClick={() => layoutStore.setAgentsMode("normal")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
    </>
  );
}
