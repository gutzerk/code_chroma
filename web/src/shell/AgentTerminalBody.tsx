import { AgentTerminal } from "../agents/AgentTerminal";
import type { AgentRecord } from "../state/types";

/** One agent's terminal (xterm carries the input line) or its lost-worktree notice; stays mounted when hidden. */
export function AgentTerminalBody({ agent, hidden = false }: { agent: AgentRecord; hidden?: boolean }) {
  const running = agent.status !== "stopped" && agent.status !== "exited";
  return (
    <div className="agent-body" hidden={hidden} data-testid={`agent-body-${agent.id}`}>
      {agent.worktree_lost ? (
        <div className="agent-window-idle" data-testid={`agent-window-idle-${agent.id}`}>
          This agent&apos;s worktree is gone. Close the agent and create a new one.
        </div>
      ) : (
        <AgentTerminal workspace={agent.id} running={running} hidden={hidden} kind={agent.kind} />
      )}
    </div>
  );
}
