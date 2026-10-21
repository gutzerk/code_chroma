import { useEffect, useRef, useState } from "react";
import { layoutStore } from "../../canvas/layout/layoutStore";
import type { AgentsMode, AgentsWidth } from "../../canvas/layout/layoutStore";
import type { AgentRecord } from "../../state/types";
import { agentStore } from "../agentStore";
import { useAgentClient } from "../AgentClientContext";
import { AgentLed, agentStatusLabel } from "../AgentLed";
import { restoreAgentWindow } from "../windowActions";
import { ChevronDownIcon, FullScreenIcon, PlusIcon, StretchIcon } from "./icons";

function agentMeta(agent: AgentRecord): string {
  return [agent.resolved_cli ?? agent.kind, agent.branch, agentStatusLabel(agent.status)].join(" · ");
}

/** The single 40px agents row: agent dropdown plus run, stretch and full screen buttons. */
export function AgentSwitcherRow({
  agents,
  activeId,
  agentsMode,
  agentsWidth,
  disabled,
  onRunAgent,
}: {
  agents: AgentRecord[];
  activeId: string | undefined;
  agentsMode: AgentsMode;
  agentsWidth: AgentsWidth;
  disabled: boolean;
  onRunAgent: () => void;
}) {
  const client = useAgentClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = agents.find((a) => a.id === activeId);
  const full = agentsMode === "full";
  const wide = agentsWidth === "wide";
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const select = (agent: AgentRecord) => {
    agentStore.clearDiagramsReady(agent.id);
    layoutStore.selectAgent(agent.id);
    restoreAgentWindow(client, agent.id);
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
                onClick={() => select(agent)}
              >
                <AgentLed status={agent.status} />
                <span className="activity-switcher-text">
                  <span className="activity-switcher-title">{agent.title}</span>
                  <span className="activity-switcher-meta">{agentMeta(agent)}</span>
                </span>
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
        aria-label={wide ? "Restore panel width" : "Stretch panel"}
        title={wide ? "Restore panel width" : "Stretch panel"}
        aria-pressed={wide}
        disabled={full}
        onClick={layoutStore.toggleAgentsWide}
      >
        <StretchIcon />
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
