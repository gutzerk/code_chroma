import { useEffect, useRef, useState } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { agentStore, useAgents, useAgentLaunchError } from "./agentStore";
import { useAgentClient } from "./AgentClientContext";
import { AgentLed, agentStatusLabel } from "./AgentLed";
import { DockedAgentPanel } from "./AgentTerminalDock";
import { restoreAgentWindow } from "./windowActions";
import { WorkflowRunScreen } from "../workflows/WorkflowRunScreen";
import { WorkflowPicker } from "../workflows/WorkflowPicker";
import { useRuns, useWorkflows } from "../workflows/workflowStore";
import "../canvas/PanelHandle.css";
import "./ActivityPanel.css";

/** Attached panel. Terminals stay mounted when tabs or visibility change. */
export function ActivityPanel({
  onRunAgent,
  disabled = false,
}: {
  onRunAgent: () => void;
  disabled?: boolean;
}) {
  const agents = useAgents();
  const client = useAgentClient();
  const { agentsMode, selectedAgentId } = useLayoutState();
  const [tab, setTab] = useState<"agents" | "workflows">("agents");
  const [picker, setPicker] = useState(false);
  const runs = useRuns();
  const workflows = useWorkflows();
  const launchError = useAgentLaunchError();
  const panelRef = useRef<HTMLElement | null>(null);
  const { size, isResizing, handleProps } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: 320,
    maxViewportFraction: 0.7,
  });
  const resizable = agentsMode === "normal";
  const collapsed = agentsMode === "collapsed";
  const working = agents.filter((a) => a.status === "working" || a.status === "running").length;
  const activeRuns = runs.filter((r) => !["done", "stopped"].includes(r.state)).length;
  const reopenItems = [
    {
      tab: "agents" as const,
      glyph: "◉",
      label: "Agents",
      total: agents.length,
      active: working,
      ariaLabel: `Open agents (${agents.length}, ${working} working)`,
      title: `Agents: ${agents.length} (${working} working)`,
    },
    {
      tab: "workflows" as const,
      glyph: "▷",
      label: "Flows",
      total: runs.length,
      active: activeRuns,
      ariaLabel: `Open workflows (${runs.length} runs, ${activeRuns} active)`,
      title: `Workflow runs: ${runs.length} (${activeRuns} active)`,
    },
  ];
  const activeId = agents.some((a) => a.id === selectedAgentId) ? selectedAgentId : agents[0]?.id;
  useEffect(() => {
    if (selectedAgentId) setTab("agents");
  }, [selectedAgentId]);
  return (
    <aside
      className={`activity-panel${agentsMode === "collapsed" ? " is-collapsed" : ""}${agentsMode === "full" ? " is-full" : ""}${isResizing ? " is-resizing" : ""}`}
      aria-label="Agents and workflows"
      data-testid="activity-panel"
      ref={panelRef}
      style={resizable && size ? { width: size.width, flexBasis: size.width } : undefined}
    >
      {resizable && (
        <div
          className="activity-resize-handle"
          data-testid="activity-resize-handle"
          aria-hidden="true"
          {...handleProps}
        />
      )}
      <div className="panel-handle panel-handle--left-edge" data-testid="activity-edge">
        {resizable && (
          <span className="panel-handle-grip" aria-hidden="true" {...handleProps}>
            <span />
            <span />
            <span />
          </span>
        )}
        <button
          type="button"
          className="panel-handle-btn"
          aria-label={
            collapsed ? "Expand agents and workflows" : "Collapse agents and workflows"
          }
          onClick={() =>
            layoutStore.setAgentsMode(collapsed ? "normal" : "collapsed")
          }
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={collapsed ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
          </svg>
        </button>
      </div>
      <div className="activity-content" hidden={agentsMode === "collapsed"}>
        <div className="left-panel-tabs" role="tablist" aria-label="Activity">
          <button
            type="button"
            className="left-panel-tab"
            role="tab"
            aria-selected={tab === "agents"}
            onClick={() => setTab("agents")}
          >
            Agents · {agents.length}
          </button>
          <button
            type="button"
            className="left-panel-tab"
            role="tab"
            aria-selected={tab === "workflows"}
            onClick={() => setTab("workflows")}
          >
            Workflows · {workflows.length}
          </button>
        </div>
        <div className="activity-actions">
          <span>
            {tab === "agents"
              ? `${agents.length} agents · ${working} working`
              : `${activeRuns} active runs`}
          </span>
          {tab === "agents" ? (
            <button type="button" aria-label="Run agent" disabled={disabled} onClick={onRunAgent}>
              ＋ Run agent
            </button>
          ) : (
            <button type="button" aria-label="Run workflow" onClick={() => setPicker((open) => !open)}>
              ▷ Run workflow
            </button>
          )}
        </div>
        {launchError && tab === "agents" && <p role="alert">{launchError}</p>}
        <div
          className="activity-agent-content"
          role="tabpanel"
          aria-label="Agents"
          hidden={tab !== "agents"}
        >
          {agents.length === 0 && (
            <p className="activity-empty">
              No agents running. Run an agent to start working in this workspace.
            </p>
          )}
          <div className="activity-agent-tabs" role="tablist" aria-label="Running agents">
            {agents.map((agent) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeId === agent.id}
                key={agent.id}
                onClick={() => {
                  agentStore.clearDiagramsReady(agent.id);
                  layoutStore.selectAgent(agent.id);
                  restoreAgentWindow(client, agent.id);
                }}
              >
                <span className="activity-agent-name">
                  <AgentLed status={agent.status} />
                  {agent.title}
                </span>
                <span className="activity-agent-meta">
                  {[agent.resolved_cli ?? agent.kind, agent.branch, agentStatusLabel(agent.status)].join(" · ")}
                </span>
              </button>
            ))}
          </div>
          {agents.map((agent) => (
            <DockedAgentPanel
              key={agent.id}
              agent={agent}
              active={tab === "agents" && activeId === agent.id && agentsMode !== "collapsed"}
              focusRequest={0}
            />
          ))}
        </div>
        <div
          className="activity-workflows"
          role="tabpanel"
          aria-label="Workflows"
          hidden={tab !== "workflows"}
        >
          {picker && <WorkflowPicker onClose={() => setPicker(false)} />}
          <WorkflowRunScreen />
        </div>
      </div>
      {agentsMode === "collapsed" && (
        <div className="activity-reopen" data-testid="activity-reopen">
          {reopenItems.map((item) => (
            <button
              key={item.tab}
              type="button"
              className="activity-reopen-item"
              aria-label={item.ariaLabel}
              title={item.title}
              onClick={() => {
                setTab(item.tab);
                layoutStore.setAgentsMode("normal");
              }}
            >
              <span className="activity-reopen-glyph" aria-hidden="true">{item.glyph}</span>
              <span className="activity-reopen-count" data-active={item.active > 0}>{item.total}</span>
              <span className="activity-reopen-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
