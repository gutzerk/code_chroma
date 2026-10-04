import { useCallback, useState } from "react";
import { ResizableRail } from "../canvas/ResizableRail";
import type { AgentRecord } from "../state/types";
import { AgentTerminal } from "./AgentTerminal";
import { useAgentClient } from "./AgentClientContext";
import { agentStore, useAgents, useAgentStartError } from "./agentStore";
import { agentDockStore, useActiveDockedAgentId, useDockedAgentIds } from "./agentDockStore";
import { AgentLed } from "./AgentLed";
import { closeAgentWindow, openAgentWindow } from "./windowActions";
import { CreatePrButton } from "./CreatePrButton";

const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;

export function AgentTerminalDock() {
  const agents = useAgents();
  const agentIds = useDockedAgentIds();
  const activeAgentId = useActiveDockedAgentId();
  const dockedAgents = agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentRecord => agent !== undefined);
  const activeAgent = dockedAgents.find((agent) => agent.id === activeAgentId);

  return (
    <ResizableRail
      className="agent-terminal-dock"
      resizingClass="agent-terminal-dock--resizing"
      ariaLabel="Docked agent terminals"
      dataTestid="agent-terminal-dock"
      handleTestid="agent-terminal-dock-resize-handle"
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      maxViewportFraction={0.65}
      hidden={dockedAgents.length === 0}
    >
      <div className="agent-terminal-dock-tabs" role="tablist" aria-label="Docked agents">
        {dockedAgents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            role="tab"
            aria-selected={agent.id === activeAgent?.id}
            aria-controls={`agent-dock-panel-${agent.id}`}
            className={`agent-terminal-dock-tab${agent.id === activeAgent?.id ? " is-active" : ""}`}
            data-testid={`agent-dock-tab-${agent.id}`}
            onClick={() => agentDockStore.activate(agent.id)}
          >
            <AgentLed status={agent.status} />
            <span>{agent.title}</span>
          </button>
        ))}
      </div>
      {dockedAgents.map((agent) => (
        <DockedAgentPanel key={agent.id} agent={agent} active={agent.id === activeAgent?.id} />
      ))}
    </ResizableRail>
  );
}

function DockedAgentPanel({ agent, active }: { agent: AgentRecord; active: boolean }) {
  const agentClient = useAgentClient();
  const startError = useAgentStartError(agent.id);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const running = agent.status !== "stopped" && agent.status !== "exited";

  const recover = useCallback(async () => {
    setRecovering(true);
    setRecoverError(null);
    try {
      agentStore.upsert(await agentClient.recreateWorktree(agent.id));
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecovering(false);
    }
  }, [agentClient, agent.id]);

  return (
    <div
      id={`agent-dock-panel-${agent.id}`}
      className="agent-terminal-dock-panel"
      role="tabpanel"
      aria-label={`${agent.title} terminal`}
      hidden={!active}
      data-testid={`agent-dock-panel-${agent.id}`}
    >
      <div className="agent-terminal-dock-header">
        <AgentLed status={agent.status} />
        <span className="agent-terminal-dock-title">{agent.title}</span>
        {agent.resolved_cli && (
          <span className="agent-window-cli" title={`launched as ${agent.resolved_cli}`}>
            {agent.resolved_cli}
          </span>
        )}
        <span className="agent-window-branch">{agent.branch}</span>
        {!agent.worktree_lost && !agent.source_pr && <CreatePrButton agent={agent} />}
        <button
          type="button"
          className="agent-window-button"
          aria-label={`Detach ${agent.title} to a window`}
          data-testid={`agent-detach-${agent.id}`}
          onClick={() => {
            agentDockStore.detach(agent.id);
            openAgentWindow(agentClient, agent.id);
          }}
        >
          ↗
        </button>
        <button
          type="button"
          className="agent-window-button"
          aria-label={`Close ${agent.title}`}
          data-testid={`agent-dock-close-${agent.id}`}
          onClick={() => closeAgentWindow(agentClient, agent.id)}
        >
          ×
        </button>
      </div>
      {agent.worktree_lost ? (
        <div className="agent-window-idle" role={recoverError || startError ? "alert" : undefined}>
          {recoverError ?? startError ??
            "This agent's worktree is gone. Recreate it to get the directory back, or close the agent."}
          <button
            type="button"
            className="agent-window-pr-button"
            disabled={recovering}
            data-testid={`agent-recreate-worktree-${agent.id}`}
            onClick={() => void recover()}
          >
            Recreate
          </button>
        </div>
      ) : (
        <AgentTerminal
          workspace={agent.id}
          running={running}
          hidden={!active}
          kind={agent.kind}
        />
      )}
    </div>
  );
}
