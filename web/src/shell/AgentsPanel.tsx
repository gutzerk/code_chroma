import { useEffect, useRef, type ReactNode } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { AgentLed } from "../agents/AgentLed";
import { useAgents } from "../agents/agentStore";
import { isAgentOnBranch } from "../agents/branchScope";
import { useCurrentBranch } from "../agents/branchStore";
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

/** The right-hand floating agents panel: a tab per agent over that agent's terminal. */
export function AgentsPanel({ codeOverlay, onRunAgent }: AgentsPanelProps) {
  const agents = useAgents();
  const current = useCurrentBranch();
  const { agents: shellAgents, codeOverlayOpen } = useShellState();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { size, isResizing, handleProps } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: AGENTS_MIN_WIDTH,
  });

  useEffect(() => {
    if (!isResizing && size) shellStore.setAgentsWidth(Math.min(size.width, AGENTS_MAX_WIDTH));
  }, [isResizing, size]);

  const activeId = agents.some((a) => a.id === shellAgents.activeId) ? shellAgents.activeId : (agents[0]?.id ?? null);

  return (
    <div
      ref={panelRef}
      className="agents-panel"
      data-testid="agents-panel"
      style={{ width: size?.width ?? shellAgents.width }}
    >
      <EdgeHandle
        edge="left"
        testId="agents-handle"
        resizeHandleProps={handleProps}
        actions={[
          { label: "Full screen agents", glyph: "‹", onClick: shellStore.agentsFull },
          { label: "Collapse agents", glyph: "›", onClick: shellStore.agentsStepOut },
        ]}
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
              onClick={() => shellStore.setActiveAgent(agent.id)}
            >
              <AgentLed status={agent.status} />
              <span>{agent.title}</span>
            </button>
          ))}
        </div>
      )}
      {agents.map((agent) => agent.id === activeId && <AgentHeader key={agent.id} agent={agent} />)}
      <div className="agents-panel-bodies">
        {agents.map((agent) => (
          <AgentTerminalBody key={agent.id} agent={agent} hidden={agent.id !== activeId} />
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
