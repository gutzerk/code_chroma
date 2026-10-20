import { useEffect, useState } from "react";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { agentStore, useAgents, useAgentLaunchError } from "./agentStore";
import { useAgentClient } from "./AgentClientContext";
import { AgentLed } from "./AgentLed";
import { DockedAgentPanel } from "./AgentTerminalDock";
import { restoreAgentWindow } from "./windowActions";
import { WorkflowRunScreen } from "../workflows/WorkflowRunScreen";
import { WorkflowPicker } from "../workflows/WorkflowPicker";
import { useRuns, useWorkflows } from "../workflows/workflowStore";
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
  const activeId = agents.some((a) => a.id === selectedAgentId) ? selectedAgentId : agents[0]?.id;
  useEffect(() => {
    if (selectedAgentId) setTab("agents");
  }, [selectedAgentId]);
  return (
    <aside
      className={`activity-panel${agentsMode === "collapsed" ? " is-collapsed" : ""}${agentsMode === "full" ? " is-full" : ""}`}
      aria-label="Agents and workflows"
      data-testid="activity-panel"
    >
      <button
        type="button"
        className="activity-edge"
        aria-label={
          agentsMode === "collapsed"
            ? "Expand agents and workflows"
            : "Collapse agents and workflows"
        }
        onClick={() =>
          layoutStore.setAgentsMode(agentsMode === "collapsed" ? "normal" : "collapsed")
        }
      >
        {agentsMode === "collapsed" ? "‹" : "›"}
      </button>
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
              ? `${agents.length} agents · ${agents.filter((a) => a.status === "working" || a.status === "running").length} working`
              : `${runs.filter((r) => !["done", "stopped"].includes(r.state)).length} active runs`}
          </span>
          {tab === "agents" ? (
            <button type="button" aria-label="Run agent" disabled={disabled} onClick={onRunAgent}>
              ＋ Run agent
            </button>
          ) : (
            <button type="button" aria-label="Run workflow" onClick={() => setPicker(!picker)}>
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
                <AgentLed status={agent.status} />
                {agent.title}
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
          <WorkflowRunScreen onAddWorkflow={() => setPicker(true)} />
        </div>
      </div>
      {agentsMode === "collapsed" && (
        <button
          type="button"
          className="activity-reopen"
          aria-label="Open agents and workflows"
          onClick={() => layoutStore.setAgentsMode("normal")}
        >
          ◉<span>{agents.length}</span>
          <span>▷</span>
          <span>{runs.length}</span>
        </button>
      )}
    </aside>
  );
}
