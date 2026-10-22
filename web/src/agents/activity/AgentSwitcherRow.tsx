import { useEffect, useRef, useState } from "react";
import { layoutStore } from "../../canvas/layout/layoutStore";
import type { AgentsMode } from "../../canvas/layout/layoutStore";
import type { AgentRecord } from "../../state/types";
import { agentStore } from "../agentStore";
import { useAgentClient } from "../AgentClientContext";
import type { AgentClient } from "../agentClient";
import { AgentLed, agentStatusLabel } from "../AgentLed";
import { restoreAgentWindow } from "../windowActions";
import { ChevronDownIcon, FullScreenIcon, PlusIcon } from "./icons";

function agentMeta(agent: AgentRecord): string {
  return [agent.resolved_cli ?? agent.kind, agent.branch, agentStatusLabel(agent.status)].join(" · ");
}

function selectAgent(client: AgentClient, agent: AgentRecord) {
  agentStore.clearDiagramsReady(agent.id);
  layoutStore.selectAgent(agent.id);
  restoreAgentWindow(client, agent.id);
}

/** Full screen's left column: every agent with its status and branch; the terminal sits beside it. */
export function AgentList({ agents, activeId }: { agents: AgentRecord[]; activeId: string | undefined }) {
  const client = useAgentClient();
  return (
    <nav className="activity-agent-list" aria-label="Agents">
      <div className="activity-agent-list-heading">Agents · {agents.length}</div>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className="activity-agent-list-item"
          aria-current={agent.id === activeId || undefined}
          data-testid={`agent-tab-${agent.id}`}
          data-diagram={agent.context_kind === "task" || undefined}
          title={agentMeta(agent)}
          onClick={() => selectAgent(client, agent)}
        >
          <AgentLed status={agent.status} />
          <span className="activity-switcher-text">
            <span className="activity-switcher-title">{agent.title}</span>
            <span className="activity-switcher-meta">
              {agentStatusLabel(agent.status)} · {agent.branch}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}

/** The single 40px agents row: agent dropdown (the left list replaces it in full screen) plus run and full screen buttons. */
export function AgentSwitcherRow({
  agents,
  activeId,
  agentsMode,
  disabled,
  onRunAgent,
}: {
  agents: AgentRecord[];
  activeId: string | undefined;
  agentsMode: AgentsMode;
  disabled: boolean;
  onRunAgent: () => void;
}) {
  const client = useAgentClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = agents.find((a) => a.id === activeId);
  const full = agentsMode === "full";
  const activeIndex = agents.findIndex((a) => a.id === activeId);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const select = (agent: AgentRecord) => {
    selectAgent(client, agent);
    setOpen(false);
  };
  return (
    <div className="activity-switcher" ref={rootRef}>
      {full ? (
        <span className="activity-switcher-spacer" />
      ) : (
      <button
        type="button"
        className="activity-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select agent"
        disabled={agents.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? (
          <>
            <AgentLed status={active.status} />
            <span className="activity-switcher-text">
              <span className="activity-switcher-title">{active.title}</span>
              <span className="activity-switcher-meta">{agentMeta(active)}</span>
            </span>
          </>
        ) : (
          <span className="activity-switcher-title">No agents</span>
        )}
        {agents.length > 0 && (
          <span
            className="activity-switcher-count"
            data-testid="agent-count"
            title={`${agents.length} ${agents.length === 1 ? "agent" : "agents"} active`}
          >
            {activeIndex >= 0 ? `${activeIndex + 1}/${agents.length}` : agents.length}
          </span>
        )}
        <ChevronDownIcon size={14} />
      </button>
      )}
      {!full && open && (
        <ul className="activity-switcher-menu" role="listbox" aria-label="Agents">
          {agents.map((agent) => (
            <li key={agent.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={agent.id === activeId}
                data-diagram={agent.context_kind === "task" || undefined}
                onClick={() => select(agent)}
              >
                <AgentLed status={agent.status} />
                <span className="activity-switcher-text">
                  <span className="activity-switcher-title">{agent.title}</span>
                  <span className="activity-switcher-meta">{agentMeta(agent)}</span>
                </span>
                {agent.context_kind === "task" && <span className="activity-agent-badge">Diagram</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="activity-icon-btn"
        aria-label="Run agent"
        title="Run agent"
        disabled={disabled}
        onClick={onRunAgent}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="activity-icon-btn"
        aria-label={full ? "Exit full screen" : "Full screen"}
        title={full ? "Exit full screen" : "Full screen"}
        aria-pressed={full}
        onClick={() => layoutStore.setAgentsMode(full ? "normal" : "full")}
      >
        <FullScreenIcon />
      </button>
    </div>
  );
}
