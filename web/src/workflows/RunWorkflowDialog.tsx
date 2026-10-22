import { useState } from "react";
import "./workflows.css";
import { ModalDialog } from "../agents/ModalDialog";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { Icon } from "./icons";
import { useWorkflows, workflowActions, workflowStore } from "./workflowStore";
import { workflowInputs, type WorkflowDef } from "./types";

/** Asks for the values a workflow's inputs need before its run starts. */
function InputsForm({
  workflow,
  busy,
  onCancel,
  onStart,
}: {
  workflow: WorkflowDef;
  busy: boolean;
  onCancel: () => void;
  onStart: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const inputs = workflowInputs(workflow);
  const missing = inputs.some((input) => !values[input.name]?.trim());
  return (
    <form
      className="wf-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!missing) onStart(values);
      }}
    >
      {inputs.map((input) => (
        <label key={input.name} className="wf-field">
          <span>{input.label || input.name}</span>
          <input
            value={values[input.name] ?? ""}
            aria-invalid={touched && !values[input.name]?.trim()}
            onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}
          />
        </label>
      ))}
      {touched && missing && <p role="alert">Fill in every input to start the run.</p>}
      <div className="wf-dialog-actions">
        <button type="button" className="wf-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="wf-btn wf-btn-primary" data-testid="start-run" disabled={busy}>
          <Icon name="play" />
          Start run
        </button>
      </div>
    </form>
  );
}

/** The small run-with-inputs picker: choose a workflow (unless one is given), fill its inputs, start the run. */
export function RunWorkflowDialog({
  workflow: initial,
  onClose,
}: {
  workflow?: WorkflowDef;
  onClose: () => void;
}) {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const [pickedId, setPickedId] = useState(initial?.id ?? workflows[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workflow = initial ?? workflows.find((w) => w.id === pickedId);

  const start = async (values: Record<string, string>) => {
    if (!workflow) return;
    setBusy(true);
    setError(null);
    await workflowActions(client).start(workflow.id, workflowInputs(workflow).length ? values : undefined);
    setBusy(false);
    const failure = workflowStore.getError();
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <ModalDialog label="Run workflow" testId="run-workflow-dialog" className="wf-dialog" onDismiss={onClose}>
      <h3 className="wf-dialog-title">{initial ? `Run: ${initial.name}` : "Run workflow"}</h3>
      {error && <p role="alert">{error}</p>}
      {!initial && (
        <label className="wf-field">
          <span>Workflow</span>
          <select value={pickedId} onChange={(e) => setPickedId(e.target.value)}>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {workflow ? (
        <InputsForm key={workflow.id} workflow={workflow} busy={busy} onCancel={onClose} onStart={(v) => void start(v)} />
      ) : (
        <p>No saved workflows yet. Create one with New workflow.</p>
      )}
    </ModalDialog>
  );
}
