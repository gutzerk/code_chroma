import { useCallback, useState } from "react";
import type { AgentRecord } from "../state/types";
import { useAgentClient } from "../agents/AgentClientContext";
import { agentStore } from "../agents/agentStore";
import { CreatePrButton } from "../agents/CreatePrButton";
import { closeAgentWindow } from "../agents/windowActions";

/** The per-agent controls the old agent window carried: CLI, branch, worktree recovery, Create PR and close. */
export function AgentHeader({ agent }: { agent: AgentRecord }) {
  const agentClient = useAgentClient();
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

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
    <div className="agent-header" data-testid={`agent-header-${agent.id}`}>
      {agent.resolved_cli && (
        <span className="agent-window-cli" title={`launched as ${agent.resolved_cli}`}>
          {agent.resolved_cli}
        </span>
      )}
      <span className="agent-window-branch">{agent.branch}</span>
      {agent.worktree_lost && (
        <>
          <span className="agent-panel-warning" title={agent.worktree} data-testid={`agent-worktree-lost-${agent.id}`}>
            {recoverError ?? "worktree lost"}
          </span>
          <button
            type="button"
            className="agent-window-pr-button"
            disabled={recovering}
            data-testid={`agent-recreate-worktree-${agent.id}`}
            onClick={() => void recover()}
          >
            Recreate
          </button>
        </>
      )}
      {!agent.worktree_lost && !agent.source_pr && <CreatePrButton agent={agent} />}
      <button
        type="button"
        className="agent-window-button agent-header-close"
        aria-label={`Close ${agent.title}`}
        data-testid={`agent-close-${agent.id}`}
        onClick={() => closeAgentWindow(agentClient, agent.id)}
      >
        ×
      </button>
    </div>
  );
}
