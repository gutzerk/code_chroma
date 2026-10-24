import { Fragment, useMemo, useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { OverflowMenu } from "./OverflowMenu";
import { RUN_STATE_COLOR, RUN_STATE_TEXT, stepMode, stepSummary } from "./runControls";
import { workflowInputs, type Run, type WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

/** The latest run of a workflow as "Running now" / "Done" / "Stopped" plus a run count. */
function lastRun(runs: Run[], workflowId: string): { text: string; color?: string; count: string } {
  const own = runs.filter((r) => r.workflowId === workflowId);
  const count = `${own.length} run${own.length === 1 ? "" : "s"}`;
  const latest = own[own.length - 1];
  if (!latest) return { text: "Never run", count };
  const text = latest.state === "running" ? "Running now" : RUN_STATE_TEXT[latest.state];
  return { text, color: latest.state === "stopped" ? RUN_STATE_COLOR.stopped : undefined, count };
}

function RenameDialog({ workflow, onCancel, onSave }: { workflow: WorkflowDef; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(workflow.name);
  const valid = name.trim().length > 0;
  return (
    <ModalDialog label="Rename workflow" testId="rename-dialog" className="wf-dialog" onDismiss={onCancel}>
      <form
        className="wf-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(name.trim());
        }}
      >
        <h3 className="wf-dialog-title">Rename workflow</h3>
        <label className="wf-field">
          <span>Name</span>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="wf-dialog-actions">
          <button type="button" className="wf-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="wf-btn wf-btn-primary" disabled={!valid}>
            Rename
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

/** The All workflows screen: every saved workflow as a table row (steps by mode, inputs, last run, actions). */
export function AllWorkflows({
  workflows,
  runs,
  actions,
  onBack,
  onEdit,
  onRun,
}: {
  workflows: WorkflowDef[];
  runs: Run[];
  actions: WorkflowActions;
  onBack: () => void;
  onEdit: (workflow: WorkflowDef) => void;
  onRun: (workflow: WorkflowDef) => void;
}) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<WorkflowDef | null>(null);
  const [deleting, setDeleting] = useState<WorkflowDef | null>(null);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? workflows.filter((w) => w.name.toLowerCase().includes(needle)) : workflows;
  }, [workflows, query]);

  return (
    <div className="wf-all" data-testid="all-workflows">
      <div className="wf-all-head">
        <button type="button" className="wf-back" aria-label="Back to runs" data-testid="all-back" onClick={onBack}>
          <Icon name="back" size={16} />
        </button>
        <h1 className="wf-all-title">
          All workflows <span>{`· ${workflows.length}`}</span>
        </h1>
        <label className="wf-search">
          <Icon name="search" size={15} />
          <span className="visually-hidden">Search workflows</span>
          <input placeholder="Search workflows" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="workflow-empty">{workflows.length === 0 ? "No saved workflows. Use New workflow to create one." : "No workflow matches the search."}</p>
      ) : (
        <div className="wf-table" role="table" aria-label="Workflows">
          <div className="wf-row wf-row-head" role="row">
            <span role="columnheader">Workflow</span>
            <span role="columnheader">Steps</span>
            <span role="columnheader">Inputs</span>
            <span role="columnheader">Last run</span>
            <span role="columnheader" className="wf-col-actions">
              Actions
            </span>
          </div>
          {shown.map((workflow) => {
            const last = lastRun(runs, workflow.id);
            const inputs = workflowInputs(workflow);
            return (
              <div className="wf-row" role="row" key={workflow.id} data-testid={`saved-${workflow.id}`}>
                <div role="cell">
                  <div className="wf-cell-name">{workflow.name}</div>
                  <div className="wf-cell-sub">{stepSummary(workflow.steps)}</div>
                </div>
                <div role="cell" className="wf-chips">
                  {workflow.steps.map((step, i) => (
                    <Fragment key={step.id}>
                      {i > 0 && <span className="wf-chip-arrow">→</span>}
                      <span className="wf-chip" data-mode={stepMode(step, i)}>{`${step.slug} · ${stepMode(step, i)}`}</span>
                    </Fragment>
                  ))}
                </div>
                <div role="cell" className="wf-cell-inputs">
                  {inputs.length ? inputs.map((input) => <code key={input.name} className="wf-input-chip">{`{{${input.name}}}`}</code>) : "None"}
                </div>
                <div role="cell">
                  <div className="wf-cell-last" style={{ color: last.color }}>
                    {last.text}
                  </div>
                  <div className="wf-cell-sub">{last.count}</div>
                </div>
                <div role="cell" className="wf-cell-actions">
                  <button type="button" className="wf-btn" aria-label={`Edit workflow ${workflow.name}`} onClick={() => onEdit(workflow)}>
                    Edit
                  </button>
                  <button type="button" className="wf-btn wf-btn-primary" aria-label={`Run ${workflow.name}`} onClick={() => onRun(workflow)}>
                    <Icon name="play" size={12} />
                    Run
                  </button>
                  <OverflowMenu
                    label={`More actions for ${workflow.name}`}
                    items={[
                      { label: "Duplicate", onSelect: () => void actions.duplicateWorkflow(workflow) },
                      { label: "Rename", onSelect: () => setRenaming(workflow) },
                      { label: "Delete", danger: true, onSelect: () => setDeleting(workflow) },
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {renaming && (
        <RenameDialog
          workflow={renaming}
          onCancel={() => setRenaming(null)}
          onSave={(name) => {
            void actions.updateWorkflow({ ...renaming, name });
            setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          label="Delete workflow"
          message={`Delete "${deleting.name}"?`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void actions.deleteWorkflow(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
