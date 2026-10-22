import { ModalDialog } from "../agents/ModalDialog";

/** A small yes/no modal for destructive run actions (restart wipes the result, delete removes the run). */
export function ConfirmDialog({
  label,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  label: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog label={label} testId="confirm-dialog" className="wf-dialog" onDismiss={onCancel}>
      <h3 className="wf-dialog-title">{label}</h3>
      <p className="wf-dialog-text">{message}</p>
      <div className="wf-dialog-actions">
        <button type="button" className="wf-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="wf-btn wf-btn-danger" data-testid="confirm-yes" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalDialog>
  );
}
