import { useOpenQuestionCount } from "../../canvas/doc/question/useOpenAgentQuestions";
import type { AgentRecord } from "../../state/types";
import { useAgentClient } from "../AgentClientContext";
import { answerPermission, dismissAgentError } from "../agentFocus";
import { BLOCKED_TEXT } from "../agentNotifications";
import { agentMeta, useElapsed } from "./agentStatusText";

/** What the agent is doing now: "Edit · src/x.ts 1:12", the permission it asks for, its error, or the plain meta. */
export function AgentStatusLine({ agent }: { agent: AgentRecord }) {
  const asking = useOpenQuestionCount(agent.id) > 0;
  const activity = agent.status === "working" ? agent.activity : null;
  const elapsed = useElapsed(activity?.turn_started_at);
  if (activity && (activity.tool || activity.target)) {
    return (
      <span className="activity-switcher-meta agent-status-line" data-status="working">
        <span className="agent-status-line-text">{[activity.tool, activity.target].filter(Boolean).join(" · ")}</span>
        {elapsed && <span className="agent-status-line-timer">{elapsed}</span>}
      </span>
    );
  }
  if (agent.status === "blocked" && agent.pending_permission) {
    return (
      <span className="activity-switcher-meta agent-status-line" data-status="blocked">
        <span className="agent-status-line-text">
          {BLOCKED_TEXT.permission}: <code>{agent.pending_permission.summary}</code>
        </span>
      </span>
    );
  }
  if (agent.status === "blocked" || asking) {
    return (
      <span className="activity-switcher-meta agent-status-line" data-status="blocked">
        {BLOCKED_TEXT.answer}
      </span>
    );
  }
  if (agent.status === "error" && agent.error) {
    return (
      <span className="activity-switcher-meta agent-status-line" data-status="error" title={agent.error.message}>
        {agent.error.message}
      </span>
    );
  }
  return <span className="activity-switcher-meta">{agentMeta(agent)}</span>;
}

/** The row's one-click answer: Allow for a pending permission, Dismiss for an error; nothing otherwise. */
export function AgentStatusActions({ agent }: { agent: AgentRecord }) {
  const client = useAgentClient();
  const permission = agent.status === "blocked" ? agent.pending_permission : null;
  if (permission && client.permission) {
    return (
      <button
        type="button"
        className="agent-status-action"
        data-status="blocked"
        data-testid={`agent-allow-${agent.id}`}
        title={`Allow ${permission.summary}`}
        onClick={() => void answerPermission(client, agent.id, permission.request_id, "allow")}
      >
        Allow
      </button>
    );
  }
  if (agent.status === "error" && client.dismissError) {
    return (
      <button
        type="button"
        className="agent-status-action"
        data-status="error"
        data-testid={`agent-dismiss-error-${agent.id}`}
        aria-label={`Dismiss ${agent.title}'s error`}
        onClick={() => void dismissAgentError(client, agent.id)}
      >
        Dismiss
      </button>
    );
  }
  return null;
}
