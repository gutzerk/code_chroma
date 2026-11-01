import { useEffect, useRef, useState } from "react";
import { layoutStore } from "../../canvas/layout/layoutStore";
import type { AgentRecord } from "../../state/types";
import { agentStore } from "../agentStore";
import { useAgentClient } from "../AgentClientContext";
import type { AgentClient } from "../agentClient";
import { AgentLed, agentStatusLabel } from "../AgentLed";
import { restoreAgentWindow } from "../windowActions";
import { ChevronDownIcon } from "./icons";

/** "<cli> · <branch> · <status>", the agent subtitle every agent list shows. */
export function agentMeta(agent: AgentRecord): string {
  return [agent.resolved_cli ?? agent.kind, agent.branch, agentStatusLabel(agent.status)].join(" · ");
}

export function selectAgent(client: AgentClient, agent: AgentRecord) {
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
          <AgentLed status={agent.status} agentId={agent.id} />
          <span className="activity-switcher-text">
            <span className="activity-switcher-title">{agent.title}</span>
            <span className="activity-switcher-meta">{agentMeta(agent)}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

/** The single 40px agents row: the agent dropdown. */
export function AgentSwitcherRow({
  agents,
  activeId,
}: {
  agents: AgentRecord[];
  activeId: string | undefined;
}) {
  const client = useAgentClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = agents.find((a) => a.id === activeId);
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
      <button
        type="button"
        className="activity-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select agent"
        title="Switch agents: Ctrl/Cmd+Alt+Up/Down"
        disabled={agents.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? (
          <>
            <AgentLed status={active.status} agentId={active.id} />
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
      {open && (
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
                <AgentLed status={agent.status} agentId={agent.id} />
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
    </div>
  );
}
