import { ModalDialog } from "./ModalDialog";

/** The rail's delete confirmation for one diagram row -- the first delete-confirmation dialog in
 * the app; every other destructive action here fires immediately with no confirmation step. */
export function DeleteDiagramDialog({
  label,
  note,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  label: string;
  /** An extra reassurance line the caller already knows to add (e.g. for a custom type, that its
   * saved definition isn't affected) -- this dialog has no diagram-specific knowledge of its own. */
  note?: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalDialog
      testId="delete-diagram-dialog"
      label={`Delete ${label}`}
      onDismiss={busy ? undefined : onCancel}
    >
      <h2 className="agent-dialog-title">Delete "{label}"?</h2>
      <p className="agent-dialog-body">
        This removes it from the canvas and deletes its file on disk.
        {note && ` ${note}`}
      </p>
      {error && <p className="agent-dialog-error">{error}</p>}
      <div className="agent-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="agent-dialog-danger"
          data-testid="delete-diagram-confirm"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </ModalDialog>
  );
}
