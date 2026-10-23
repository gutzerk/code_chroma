import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { useAgents, useAgentLaunchError } from "./agentStore";
import { DockedAgentPanel } from "./AgentTerminalDock";
import { WorkflowsTab } from "../workflows/WorkflowsTab";
import { AgentsHeaderActions } from "./activity/AgentsHeaderActions";
import { WorkflowsHeaderActions } from "../workflows/WorkflowsHeaderActions";
import { useRuns, workflowStore } from "../workflows/workflowStore";
import { isFinished } from "../workflows/runControls";
import { AgentList, AgentSwitcherRow } from "./activity/AgentSwitcherRow";
import { CollapsedStrip, type ActivityTab } from "./activity/CollapsedStrip";
import { ExpandIcon, HandleChevronLeft, HandleChevronRight, HandleCollapse } from "./activity/icons";
import { usePanelSize } from "./activity/usePanelSize";
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
  const { agentsMode, leftOpen, selectedAgentId } = useLayoutState();
  const [tab, setTab] = useState<ActivityTab>("agents");
  const runs = useRuns();
  const activeRuns = runs.filter((r) => !isFinished(r.state)).length;
  const launchError = useAgentLaunchError();
  const panelRef = useRef<HTMLElement | null>(null);
  const isFull = agentsMode === "full";
  const { size, isResizing, handleProps, resetSize } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: 320,
    maxViewportFraction: isFull ? 0.95 : 0.7,
    onExceedMax: isFull ? undefined : () => layoutStore.setAgentsMode("full"),
  });
  const panelSize = usePanelSize(panelRef);
  const collapsed = agentsMode === "collapsed";
  const resizable = agentsMode === "normal";
  const stretchWidth = useStretchWidth(panelRef, isFull, leftOpen);
  useEffect(() => resetSize(), [agentsMode]); // eslint-disable-line react-hooks/exhaustive-deps
  let style: CSSProperties | undefined;
  if (resizable && size) style = { width: size.width, flexBasis: size.width };
  else if (stretchWidth !== null) style = { width: stretchWidth, flexBasis: stretchWidth };
  const activeId = agents.some((a) => a.id === selectedAgentId) ? selectedAgentId : agents[0]?.id;
  useEffect(() => {
    if (tab !== "workflows" || collapsed) workflowStore.setDialog(null);
  }, [tab, collapsed]);
  useEffect(() => {
    if (selectedAgentId) setTab("agents");
  }, [selectedAgentId]);
  // Entering full screen (or switching agents inside it) moves the cursor into that agent's terminal.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (isFull && activeId) setFocusRequest((n) => n + 1);
  }, [isFull, activeId]);
  return (
    <aside
      className={`activity-panel${collapsed ? " is-collapsed" : ""}${isFull ? " is-full" : ""}${isResizing ? " is-resizing" : ""}`}
      aria-label="Agents and workflows"
      data-testid="activity-panel"
      data-size={panelSize}
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
            aria-label={isFull ? "Restore panel width" : "Stretch panel"}
            title={isFull ? "Restore panel width" : "Stretch panel"}
            aria-pressed={isFull}
            onClick={layoutStore.toggleAgentsFull}
          >
            {isFull ? <HandleChevronRight /> : <HandleChevronLeft />}
          </button>
        )}
        {resizable && (
          <span className="panel-handle-grip" aria-hidden="true" {...handleProps}>
            <span />
            <span />
            <span />
          </span>
        )}
        {!collapsed && agentsMode === "normal" && (
          <button
            type="button"
            className="panel-handle-btn"
            aria-label="Collapse panel"
            title="Collapse panel"
            onClick={() => layoutStore.setAgentsMode("collapsed")}
          >
            <HandleCollapse />
          </button>
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
        <div className="activity-header" data-tab={tab}>
          <div className="activity-segmented" role="tablist" aria-label="Activity">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              onClick={() => setTab("agents")}
            >
              Agents <span className="activity-count">{`· ${agents.length}`}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "workflows"}
              onClick={() => setTab("workflows")}
            >
              Workflows <span className="activity-count">{`· ${activeRuns}`}</span>
            </button>
          </div>
          {tab === "workflows" ? (
            <WorkflowsHeaderActions agentsMode={agentsMode} disabled={disabled} />
          ) : (
            <AgentsHeaderActions agentsMode={agentsMode} disabled={disabled} onRunAgent={onRunAgent} />
          )}
        </div>
        {launchError && tab === "agents" && <p role="alert">{launchError}</p>}
        <div
          className="activity-agent-content"
          role="tabpanel"
          aria-label="Agents"
          hidden={tab !== "agents"}
        >
          <AgentSwitcherRow agents={agents} activeId={activeId ?? undefined} full={isFull} />
          {isFull && <AgentList agents={agents} activeId={activeId ?? undefined} />}
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
              full={isFull}
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
