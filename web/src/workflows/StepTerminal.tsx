import { useEffect, useState } from "react";
import { useOptionalAgentClient } from "../agents/AgentClientContext";
import { AgentTerminal } from "../agents/AgentTerminal";
import { ensureStepAgent } from "../agents/launchAgent";
import { useAgents, useAgentStartError } from "../agents/agentStore";
import type { StepRecord } from "./types";

/** The Agent tab of a finished step: a real terminal on a claude session forked from the step's, started once per step (`ensureStepAgent`) and re-attached on every later open. */
export function StepTerminal({ runId, slug, step }: { runId: string; slug: string; step: StepRecord }) {
  const client = useOptionalAgentClient();
  const agents = useAgents();
  const sessionId = step.sessionId;
  const agent = agents.find((a) => a.source_run === runId && a.fork_session === sessionId);
  const [error, setError] = useState<string | null>(null);
  const startError = useAgentStartError(agent?.id ?? "");

  useEffect(() => setError(null), [sessionId]);

  useEffect(() => {
    if (!client || !sessionId || agent) return;
    ensureStepAgent(client, `${slug} ${runId}`, runId, sessionId).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [client, sessionId, agent, slug, runId]);

  const failure = startError ?? error;
  if (!agent || startError) {
    return (
      <p className="live-line" role={failure ? "alert" : "status"} data-testid="step-terminal-status">
        {failure ?? "Starting the agent in this step's session…"}
      </p>
    );
  }
  const running = agent.status !== "stopped" && agent.status !== "exited";
  return (
    <div className="wf-step-terminal" data-testid="step-terminal">
      <AgentTerminal workspace={agent.id} running={running} kind={agent.kind} />
    </div>
  );
}
