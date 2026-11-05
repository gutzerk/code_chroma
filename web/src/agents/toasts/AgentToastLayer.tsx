import { useAgentClient } from "../AgentClientContext";
import { answerPermission, openAgent } from "../agentFocus";
import { useAgents } from "../agentStore";
import { StatusIndicator } from "../StatusIndicator";
import { agentToastStore, useAgentToasts, type AgentToast } from "./toastStore";
import "./AgentToastLayer.css";

function ToastCard({ toast }: { toast: AgentToast }) {
  const client = useAgentClient();
  const agent = useAgents().find((candidate) => candidate.id === toast.agentId);
  const permission = toast.kind === "blocked" ? agent?.pending_permission : null;
  return (
    <div
      className="agent-toast"
      data-status={toast.kind}
      data-testid={`agent-toast-${toast.agentId}`}
      role={toast.kind === "done" ? "status" : "alert"}
    >
      <StatusIndicator status={toast.kind} size="icon" />
      <div className="agent-toast-text">
        <div className="agent-toast-title">{toast.title}</div>
        <div className="agent-toast-body">{toast.body}</div>
        <div className="agent-toast-actions">
          {permission && client.permission && (
            <button
              type="button"
              className="agent-toast-primary"
              onClick={() => void answerPermission(client, toast.agentId, permission.request_id, "allow")}
            >
              Allow
            </button>
          )}
          <button type="button" className="agent-toast-secondary" onClick={() => openAgent(client, toast.agentId)}>
            Open agent
          </button>
        </div>
      </div>
      {toast.kind !== "blocked" && (
        <button
          type="button"
          className="agent-toast-close"
          aria-label="Close notification"
          onClick={() => agentToastStore.dismiss(toast.agentId)}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Bottom-right stack: blocked stays until answered, error until closed, done for 6 s. */
export function AgentToastLayer() {
  const toasts = useAgentToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="agent-toast-layer" data-testid="agent-toast-layer" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.agentId} toast={toast} />
      ))}
    </div>
  );
}
