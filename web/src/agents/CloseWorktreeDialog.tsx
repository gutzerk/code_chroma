import { useState } from "react";
import { ModalDialog } from "./ModalDialog";
import { messageOf } from "../util/reportError";
import { useAgentCountInWorkspace } from "./agentStore";
import { rememberCloseChoice, type CloseChoice } from "./closeChoice";

/** The tab-close prompt: keep the worktree on disk or delete it, with the cost spelled out first.
 * Deleting is never blocked by uncommitted work, so the dirty count and the agents that will be
 * closed are shown up front. Busy/error stay local to the running confirm, like CloseAgentDialog. */
export function CloseWorktreeDialog({
  id,
  name,
  dirty,
  onCancel,
  onConfirm,
}: {
  id: string;
  name: string;
  dirty: number;
  onCancel: () => void;
  /** Runs the close; rejects with the bridge's refusal on failure. */
  onConfirm: (choice: CloseChoice) => Promise<void>;
}) {
  const agentCount = useAgentCountInWorkspace(id);
  const [dontAsk, setDontAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (choice: CloseChoice) => {
    setBusy(true);
    setError(null);
    onConfirm(choice)
      .then(() => {
        if (dontAsk) rememberCloseChoice(choice);
      })
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalDialog testId="close-worktree-dialog" label={`Close ${name}`} onDismiss={busy ? undefined : onCancel}>
      <h2 className="agent-dialog-title">Close "{name}"?</h2>
      <p className="agent-dialog-body" data-testid="close-worktree-dirty">
        {dirty > 0
          ? `This worktree has ${dirty} uncommitted ${dirty === 1 ? "change" : "changes"}; deleting it discards them.`
          : "This worktree has no uncommitted changes."}
      </p>
      <p className="agent-dialog-body" data-testid="close-worktree-agents">
        {agentCount > 0
          ? `${agentCount} attached ${agentCount === 1 ? "agent" : "agents"} will be closed.`
          : "No agents are attached."}
      </p>
      <label className="agent-dialog-check">
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(event) => setDontAsk(event.target.checked)}
          data-testid="close-worktree-dont-ask"
        />
        Don't ask again
      </label>
      {error && <p className="agent-dialog-error">{error}</p>}
      <div className="agent-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" data-testid="close-worktree-keep" onClick={() => choose("keep")} disabled={busy}>
          Keep
        </button>
        <button
          type="button"
          className="agent-dialog-danger"
          data-testid="close-worktree-delete"
          onClick={() => choose("delete")}
          disabled={busy}
        >
          Delete worktree
        </button>
      </div>
    </ModalDialog>
  );
}
