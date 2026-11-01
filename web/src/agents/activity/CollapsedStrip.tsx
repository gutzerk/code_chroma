import type { ReactNode } from "react";
import type { AgentRecord } from "../../state/types";
import { layoutStore } from "../../canvas/layout/layoutStore";
import type { Run } from "../../workflows/types";
import { agentStore } from "../agentStore";
import { AgentLed, agentStatusLabel } from "../AgentLed";
import { agentInitials } from "./initials";
import { AgentsIcon, PlusIcon, WorkflowsIcon } from "./icons";

export type ActivityTab = "agents" | "workflows";

function StripButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="activity-strip-btn"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="rail-tooltip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

/** The 52px collapsed strip: tab icons with counts, one avatar per agent, and a run button. */
export function CollapsedStrip({
  agents,
  runs,
  disabled,
  onOpenTab,
  onRunAgent,
}: {
  agents: AgentRecord[];
  runs: Run[];
  disabled: boolean;
  onOpenTab: (tab: ActivityTab) => void;
  onRunAgent: () => void;
}) {
  const working = agents.filter((a) => a.status === "working" || a.status === "running").length;
  const activeRuns = runs.filter((r) => !["done", "stopped"].includes(r.state)).length;
  const needsYou = runs.some((r) => r.state === "needs_you");
  return (
    <div className="activity-strip" data-testid="activity-reopen">
      <StripButton
        label={`Open agents (${agents.length}, ${working} working)`}
        onClick={() => onOpenTab("agents")}
      >
        <AgentsIcon size={20} />
        <span className="activity-badge" data-active={working > 0} data-testid="strip-agents-count">
          {agents.length}
        </span>
      </StripButton>
      <StripButton
        label={`Open workflows (${runs.length} runs, ${activeRuns} active)`}
        onClick={() => onOpenTab("workflows")}
      >
        <WorkflowsIcon size={20} />
        <span
          className="activity-badge"
          data-active={activeRuns > 0}
          data-needs-you={needsYou}
          data-testid="strip-workflows-count"
        >
          {needsYou ? "!" : activeRuns}
        </span>
      </StripButton>
      <span className="activity-strip-divider" aria-hidden="true" />
      {agents.map((agent) => (
        <StripButton
          key={agent.id}
          label={`Open ${agent.title} (${agentStatusLabel(agent.status)})`}
          onClick={() => {
            agentStore.clearDiagramsReady(agent.id);
            layoutStore.selectAgent(agent.id);
            onOpenTab("agents");
          }}
        >
          <span className="activity-avatar">
            {agentInitials(agent.title)}
            <AgentLed status={agent.status} agentId={agent.id} />
          </span>
        </StripButton>
      ))}
      <StripButton label="Run agent" disabled={disabled} onClick={onRunAgent}>
        <PlusIcon size={18} />
      </StripButton>
    </div>
  );
}
