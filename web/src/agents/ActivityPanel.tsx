import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { useAgents, useAgentLaunchError } from "./agentStore";
import { DockedAgentPanel } from "./AgentTerminalDock";
import { WorkflowsTab } from "../workflows/WorkflowsTab";
import { useRuns, useWorkflows } from "../workflows/workflowStore";
import { AgentSwitcherRow } from "./activity/AgentSwitcherRow";
import { CollapsedStrip, type ActivityTab } from "./activity/CollapsedStrip";
import { CollapseIcon, ExpandIcon } from "./activity/icons";
import { useStretchWidth } from "./activity/useStretchWidth";
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
  const { agentsMode, agentsWidth, leftOpen, selectedAgentId } = useLayoutState();
  const [tab, setTab] = useState<ActivityTab>("agents");
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
  const resizable = agentsMode === "normal" && agentsWidth === "default";
  const collapsed = agentsMode === "collapsed";
  const wide = agentsMode === "normal" && agentsWidth === "wide";
  const wideWidth = useStretchWidth(panelRef, wide, leftOpen);
  let style: CSSProperties | undefined;
  if (wideWidth !== null) style = { width: wideWidth, flexBasis: wideWidth };
  else if (resizable && size) style = { width: size.width, flexBasis: size.width };
  const activeId = agents.some((a) => a.id === selectedAgentId) ? selectedAgentId : agents[0]?.id;
  useEffect(() => {
    if (selectedAgentId) setTab("agents");
  }, [selectedAgentId]);
  return (
    <aside
      className={`activity-panel${collapsed ? " is-collapsed" : ""}${agentsMode === "full" ? " is-full" : ""}${wide ? " is-wide" : ""}${isResizing ? " is-resizing" : ""}`}
      aria-label="Agents and workflows"
      data-testid="activity-panel"
      ref={panelRef}
      style={style}
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
        {collapsed && (
          <button
            type="button"
            className="panel-handle-btn"
            aria-label="Expand agents and workflows"
            onClick={() => layoutStore.setAgentsMode("normal")}
          >
            <ExpandIcon size={12} />
          </button>
        )}
      </div>
      <div className="activity-content" hidden={collapsed}>
        <div className="activity-header">
          <div className="activity-segmented" role="tablist" aria-label="Activity">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              onClick={() => setTab("agents")}
            >
              Agents <span className="activity-count">{agents.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "workflows"}
              onClick={() => setTab("workflows")}
            >
              Workflows <span className="activity-count">{workflows.length}</span>
            </button>
          </div>
          <button
            type="button"
            className="activity-icon-btn"
            aria-label="Collapse agents and workflows"
            title="Collapse"
            onClick={() => layoutStore.setAgentsMode("collapsed")}
          >
            <CollapseIcon />
          </button>
        </div>
        {launchError && tab === "agents" && <p role="alert">{launchError}</p>}
        <div
          className="activity-agent-content"
          role="tabpanel"
          aria-label="Agents"
          hidden={tab !== "agents"}
        >
          <AgentSwitcherRow
            agents={agents}
            activeId={activeId ?? undefined}
            agentsMode={agentsMode}
            agentsWidth={agentsWidth}
            disabled={disabled}
            onRunAgent={onRunAgent}
          />
          {agents.length === 0 && (
            <p className="activity-empty">
              No agents running. Run an agent to start working in this workspace.
            </p>
          )}
          {agents.map((agent) => (
            <DockedAgentPanel
              key={agent.id}
              agent={agent}
              active={tab === "agents" && activeId === agent.id && !collapsed}
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
          <WorkflowsTab />
        </div>
      </div>
      {collapsed && (
        <CollapsedStrip
          agents={agents}
          runs={runs}
          disabled={disabled}
          onRunAgent={onRunAgent}
          onOpenTab={(next) => {
            setTab(next);
            layoutStore.setAgentsMode("normal");
          }}
        />
      )}
    </aside>
  );
}
