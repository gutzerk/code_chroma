import { useId, useState } from "react";
import "./workflows.css";
import { ModalDialog } from "../agents/ModalDialog";
import { useOptionalAgentClient } from "../agents/AgentClientContext";
import { agentStore, useAgentCapacityReason, useIsLaunchingAgent } from "../agents/agentStore";
import { launchWorkflowAgent } from "../agents/launchAgent";
import { useActiveWorktreeId } from "../agents/worktreeStore";
import { Icon } from "./icons";
import { workflowStore } from "./workflowStore";

/** Same limit as a Draw request (`max_request_chars` in kinds.json); the bridge refuses longer ones. */
const MAX_REQUEST_CHARS = 2000;

/** The New workflow chooser: describe it and let an agent design and save it, or open the editor and build it by hand. */
export function NewWorkflowDialog({ onClose }: { onClose: () => void }) {
  const agentClient = useOptionalAgentClient();
  const capacityReason = useAgentCapacityReason();
  const isLaunching = useIsLaunchingAgent();
  const activeTab = useActiveWorktreeId();
  const requestId = useId();
  const [withAgent, setWithAgent] = useState(false);
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);

  const agentBlocked = !agentClient
    ? "Agents are not available here"
    : !activeTab
      ? "Open a worktree tab first: the agent works in it"
      : capacityReason;
  const canStart = !agentBlocked && !isLaunching && request.trim().length > 0;

  const start = async () => {
    if (!agentClient || !canStart) return;
    setError(null);
    // Stays open (keeping the description) unless an agent was created: git setup or a create error leaves it here.
    if (await launchWorkflowAgent(agentClient, request.trim())) onClose();
    else setError(agentStore.getLaunchError());
  };

  return (
    <ModalDialog label="New workflow" testId="new-workflow-dialog" className="wf-dialog wf-create-dialog" onDismiss={onClose}>
      <h3 className="wf-dialog-title">New workflow</h3>
      <div className="wf-create-options" role="group" aria-label="How to create the workflow">
        <button
          type="button"
          className="wf-create-option"
          aria-expanded={withAgent}
          aria-controls={withAgent ? requestId : undefined}
          data-testid="create-with-agent"
          disabled={!!agentBlocked}
          title={agentBlocked}
          onClick={() => setWithAgent(true)}
        >
          <span className="wf-create-option-title">
            <Icon name="agent" size={14} />
            With an agent
          </span>
          <span className="wf-create-option-text">Describe what it should do. An agent designs the steps and saves the workflow.</span>
        </button>
        <button
          type="button"
          className="wf-create-option"
          data-testid="create-by-hand"
          onClick={() => workflowStore.setDialog({ kind: "editor" })}
        >
          <span className="wf-create-option-title">
            <Icon name="edit" size={14} />
            By hand
          </span>
          <span className="wf-create-option-text">Open the editor and add the steps yourself.</span>
        </button>
      </div>
      {agentBlocked && <p className="wf-dialog-text">{agentBlocked}</p>}
      <form
        className="wf-form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        {withAgent && (
          <label className="wf-field" id={requestId}>
            <span>What should the workflow do?</span>
            <textarea
              className="wf-create-request"
              autoFocus
              rows={5}
              maxLength={MAX_REQUEST_CHARS}
              placeholder="e.g. Take an issue, plan the fix, implement it with tests, then let me review the diff."
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="wf-dialog-actions">
          <button type="button" className="wf-btn" onClick={onClose}>
            Cancel
          </button>
          {withAgent && (
            <button type="submit" className="wf-btn wf-btn-primary" data-testid="start-workflow-agent" disabled={!canStart}>
              {isLaunching ? "Starting…" : "Start agent"}
            </button>
          )}
        </div>
      </form>
    </ModalDialog>
  );
}
