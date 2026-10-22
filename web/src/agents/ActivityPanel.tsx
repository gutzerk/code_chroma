import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { chromeInsets } from "../canvas/layout/layoutMetrics";
import { useAgents, useAgentLaunchError } from "./agentStore";
import { DockedAgentPanel } from "./AgentTerminalDock";
import { WorkflowsTab } from "../workflows/WorkflowsTab";
import { useRuns, useWorkflows } from "../workflows/workflowStore";
import { AgentList, AgentSwitcherRow } from "./activity/AgentSwitcherRow";
import { CollapsedStrip, type ActivityTab } from "./activity/CollapsedStrip";
import { CollapseIcon, ExpandIcon, HandleChevronLeft, HandleChevronRight } from "./activity/icons";
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
  const { agentsMode, leftOpen, selectedAgentId } = useLayoutState();
  const [tab, setTab] = useState<ActivityTab>("agents");
  const runs = useRuns();
  const workflows = useWorkflows();
  const launchError = useAgentLaunchError();
  const panelRef = useRef<HTMLElement | null>(null);
  const full = agentsMode === "full";
  const { size, isResizing, handleProps, resetSize } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: 320,
    maxViewportFraction: full ? 0.95 : 0.7,
    onExceedMax: full ? undefined : () => layoutStore.setAgentsMode("full"),
  });
  const collapsed = agentsMode === "collapsed";
  const resizable = !collapsed;
  useEffect(() => resetSize(), [agentsMode]); // eslint-disable-line react-hooks/exhaustive-deps
  let style: CSSProperties | undefined;
  if (full && !size) style = { left: chromeInsets({ leftOpen, agentsMode }).agentsFullLeft };
  else if (resizable && size) style = full ? { left: "auto", width: size.width } : { width: size.width };
  const activeId = agents.some((a) => a.id === selectedAgentId) ? selectedAgentId : agents[0]?.id;
  useEffect(() => {
    if (selectedAgentId) setTab("agents");
  }, [selectedAgentId]);
  // Entering full screen (or switching agents inside it) moves the cursor into that agent's terminal.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (full && activeId) setFocusRequest((n) => n + 1);
  }, [full, activeId]);
  return (
    <aside
      className={`activity-panel${collapsed ? " is-collapsed" : ""}${full ? " is-full" : ""}${isResizing ? " is-resizing" : ""}`}
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
        {!collapsed && (
          <button
            type="button"
            className="panel-handle-btn"
            aria-label={full ? "Restore panel width" : "Stretch panel"}
            title={full ? "Restore panel width" : "Stretch panel"}
            aria-pressed={full}
            onClick={layoutStore.toggleAgentsFull}
          >
            {full ? <HandleChevronRight /> : <HandleChevronLeft />}
          </button>
        )}
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
        {!collapsed && (
          <button
            type="button"
            className="panel-handle-btn"
            aria-label="Collapse agents and workflows"
            onClick={() => layoutStore.setAgentsMode("collapsed")}
          >
            <CollapseIcon size={12} />
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
            disabled={disabled}
            onRunAgent={onRunAgent}
          />
          {full && <AgentList agents={agents} activeId={activeId ?? undefined} />}
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
              focusRequest={focusRequest}
              full={full}
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
