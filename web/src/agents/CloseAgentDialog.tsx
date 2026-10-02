import { useState } from "react";
import { ModalDialog } from "./ModalDialog";

/** The "×" confirmation shown only when the agent is the last one on its own worktree — the one
 * case where closing can also delete that directory. Ask deliberately, with the "delete worktree"
 * checkbox off by default, because a closed agent is meant to be picked back up by attaching a new
 * one to its surviving `agent/<id>` branch: an accidental delete truly destroys that work. The
 * branch never has a checkbox here — we never delete it from the UI.
 *
 * Busy/error are local to the running confirm (mirroring `GitInitDialog`): visibility lives in the
 * store (`pendingClose`), the transient in-flight state here. */
export function CloseAgentDialog({
  title,
  worktree,
  onCancel,
  onConfirm,
}: {
  title: string;
  worktree: string;
  onCancel: () => void;
  /** Runs the delete; resolves only on success, rejects with the bridge's refusal on failure. */
  onConfirm: (deleteWorktree: boolean) => Promise<void>;
}) {
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    setBusy(true);
    setError(null);
    void onConfirm(deleteWorktree)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "close failed"))
      .finally(() => setBusy(false));
  };

  return (
    <ModalDialog
      testId="close-agent-dialog"
      label={`Close ${title}`}
      onDismiss={busy ? undefined : onCancel}
    >
      <h2 className="agent-dialog-title">Close "{title}"?</h2>
      <p className="agent-dialog-body">
        This closes the agent's session and removes its card. Its <code>{worktree}</code> worktree
        and the <code>{`agent/*`}</code> branch are kept by default, so another agent can pick the
        work back up.
      </p>
      <label className="agent-dialog-check">
        <input
          type="checkbox"
          checked={deleteWorktree}
          onChange={(event) => setDeleteWorktree(event.target.checked)}
          data-testid="close-agent-delete-worktree"
        />
        Also delete the worktree directory
      </label>
      {error && <p className="agent-dialog-error">{error}</p>}
      <div className="agent-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="agent-dialog-danger"
          data-testid="close-agent-confirm"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? "Closing…" : "Close"}
        </button>
      </div>
    </ModalDialog>
  );
}
