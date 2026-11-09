import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { AgentRecord } from "../../state/types";
import { useAgentClient } from "../AgentClientContext";
import { selectAgent } from "../agentFocus";
import { AgentStatusActions, AgentStatusLine } from "./AgentStatusLine";
import { agentMeta, useAgentStatus } from "./agentStatusText";
import { ChevronDownIcon } from "./icons";

/** An agent row: its background is tinted by the shown status (`data-status`); the status is also spoken text, never colour alone. */
function AgentRowButton({
  agent,
  children,
  ...props
}: { agent: AgentRecord; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { shown, label } = useAgentStatus(agent.status, agent.id);
  return (
    <button type="button" {...props} data-status={shown}>
      <span className="visually-hidden">{label}</span>
      <span className="activity-switcher-text">
        <span className="activity-switcher-title">{agent.title}</span>
        <AgentStatusLine agent={agent} />
      </span>
      {children}
    </button>
  );
}

/** Full screen's left column: every agent with its status and branch; the terminal sits beside it. */
export function AgentList({ agents, activeId }: { agents: AgentRecord[]; activeId: string | undefined }) {
  const client = useAgentClient();
  return (
    <nav className="activity-agent-list" aria-label="Agents">
      <div className="activity-agent-list-heading">Agents · {agents.length}</div>
      {agents.map((agent) => (
        <div key={agent.id} className="activity-agent-list-row">
          <AgentRowButton
            agent={agent}
            className="activity-agent-list-item"
            aria-current={agent.id === activeId || undefined}
            data-testid={`agent-tab-${agent.id}`}
            data-diagram={agent.context_kind === "task" || undefined}
            title={agentMeta(agent)}
            onClick={() => selectAgent(client, agent)}
          />
          <AgentStatusActions agent={agent} />
        </div>
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
  const menuId = useId();
  const active = agents.find((a) => a.id === activeId);
  const activeIndex = agents.findIndex((a) => a.id === activeId);
  const activeStatus = useAgentStatus(active?.status ?? "idle", active?.id ?? "");
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
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Select agent"
        aria-description={active ? activeStatus.label : undefined}
        data-status={active ? activeStatus.shown : undefined}
        data-testid="agent-switcher-trigger"
        title="Switch agents: Ctrl/Cmd+Alt+Up/Down · next waiting agent: Ctrl/Cmd+Shift+J"
        disabled={agents.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? (
          <>
            <span className="activity-switcher-text">
              <span className="activity-switcher-title">{active.title}</span>
              <AgentStatusLine agent={active} />
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
      {active && <AgentStatusActions agent={active} />}
      {open && (
        <ul id={menuId} className="activity-switcher-menu" aria-label="Agents">
          {agents.map((agent) => (
            <li key={agent.id} className="activity-switcher-option">
              <AgentRowButton
                agent={agent}
                className="activity-switcher-option-button"
                aria-current={agent.id === activeId || undefined}
                data-diagram={agent.context_kind === "task" || undefined}
                data-testid={`agent-option-${agent.id}`}
                onClick={() => select(agent)}
              >
                {agent.context_kind === "task" && <span className="activity-agent-badge">Diagram</span>}
              </AgentRowButton>
              {agent.id !== activeId && <AgentStatusActions agent={agent} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
