import { useEffect, useRef, type ReactNode } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { AgentLed } from "../agents/AgentLed";
import { useAgentClient } from "../agents/AgentClientContext";
import { useAgents } from "../agents/agentStore";
import { isAgentOnBranch } from "../agents/branchScope";
import { useCurrentBranch } from "../agents/branchStore";
import { selectAgent } from "./selectAgent";
import { EdgeHandle } from "./EdgeHandle";
import { AgentHeader } from "./AgentHeader";
import { AgentTerminalBody } from "./AgentTerminalBody";
import { AGENTS_MAX_WIDTH, AGENTS_MIN_WIDTH, shellStore, useShellState } from "./shellStore";
import "./agentsPanel.css";

export interface AgentsPanelProps {
  /** Rendered over the panel body while shellStore.codeOverlayOpen; the agent terminals stay mounted underneath. */
  codeOverlay?: ReactNode;
  /** Hint action shown in the empty state. */
  onRunAgent?: () => void;
}

/** The right-hand floating agents panel: a tab per agent over that agent's terminal, or every agent as a column in full screen. */
export function AgentsPanel({ codeOverlay, onRunAgent }: AgentsPanelProps) {
  const agents = useAgents();
  const agentClient = useAgentClient();
  const current = useCurrentBranch();
  const { agents: shellAgents, codeOverlayOpen } = useShellState();
  const full = shellAgents.mode === "full";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { size, isResizing, handleProps, resetSize } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: AGENTS_MIN_WIDTH,
  });

  useEffect(() => {
    if (isResizing || !size) return;
    shellStore.setAgentsWidth(Math.min(size.width, AGENTS_MAX_WIDTH));
    resetSize();
  }, [isResizing, size, resetSize]);

  useEffect(() => {
    if (!full) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") shellStore.agentsStepOut();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [full]);

  const activeId = agents.some((a) => a.id === shellAgents.activeId) ? shellAgents.activeId : (agents[0]?.id ?? null);
  const count = Math.max(agents.length, 1);
  const columns = count >= 4 ? Math.ceil(Math.sqrt(count)) : count;

  return (
    <div
      ref={panelRef}
      className={`agents-panel${full ? " is-full" : ""}`}
      data-testid="agents-panel"
      style={full ? undefined : { width: size?.width ?? shellAgents.width }}
    >
      <EdgeHandle
        edge="left"
        testId="agents-handle"
        resizeHandleProps={full ? undefined : handleProps}
        actions={
          full
            ? [{ label: "Exit full screen agents", glyph: "›", onClick: shellStore.agentsStepOut }]
            : [
                { label: "Full screen agents", glyph: "‹", onClick: shellStore.agentsFull },
                { label: "Collapse agents", glyph: "›", onClick: shellStore.agentsStepOut },
              ]
        }
      />
      {agents.length === 0 ? (
        <div className="agents-panel-empty" data-testid="agents-empty">
          No agents running.{" "}
          {onRunAgent ? (
            <button type="button" onClick={onRunAgent}>
              Run agent
            </button>
          ) : (
            "Run an agent to start."
          )}
        </div>
      ) : (
        !full && (
          <div className="agents-panel-tabs" role="tablist" aria-label="Agents">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="tab"
                aria-selected={agent.id === activeId}
                className={`agents-tab${agent.id === activeId ? " is-active" : ""}${
                  isAgentOnBranch(agent, current) ? "" : " agents-tab-off-branch"
                }`}
                data-testid={`agents-tab-${agent.id}`}
                onClick={() => selectAgent(agentClient, agent.id)}
              >
                <AgentLed status={agent.status} />
                <span>{agent.title}</span>
              </button>
            ))}
          </div>
        )
      )}
      {!full && agents.map((agent) => agent.id === activeId && <AgentHeader key={agent.id} agent={agent} />)}
      <div
        className="agents-panel-bodies"
        data-testid={full ? "agents-fullscreen" : undefined}
        style={full ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {agents.map((agent) => (
          <section
            key={agent.id}
            className="agents-column"
            data-testid={full ? `agents-column-${agent.id}` : undefined}
          >
            {full && (
              <div className="agents-column-title">
                <AgentLed status={agent.status} />
                <span>{agent.title}</span>
                <AgentHeader agent={agent} />
              </div>
            )}
            <AgentTerminalBody agent={agent} hidden={!full && agent.id !== activeId} />
          </section>
        ))}
        {codeOverlayOpen && (
          <div className="agents-panel-overlay" data-testid="agents-code-overlay">
            {codeOverlay}
          </div>
        )}
      </div>
    </div>
  );
}
