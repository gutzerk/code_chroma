import { useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { OverflowMenu } from "./OverflowMenu";
import { RUN_STATE_COLOR, RUN_STATE_TEXT } from "./runControls";
import { agentMode, workflowInputs, type Run, type WorkflowDef, type WorkflowStepDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

type ChipMode = "new" | "handoff" | "continue" | "you";

const CHIP_TEXT: Record<ChipMode, string> = { new: "New", handoff: "Hand-off", continue: "Continue", you: "You" };

/** How a step's chip reads: review steps are "You", agent steps by their agent mode (missing reads as hand-off, like the bridge). */
export function stepChipMode(step: WorkflowStepDef): ChipMode {
  return step.kind === "review" ? "you" : agentMode(step.agent);
}

/** A new id for a copy of `id` that no saved workflow uses yet. */
export function copyId(id: string, taken: string[]): string {
  const base = `${id}-copy`;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function RenameDialog({ workflow, onCancel, onSave }: { workflow: WorkflowDef; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(workflow.name);
  const trimmed = name.trim();
  return (
    <ModalDialog label="Rename workflow" testId="rename-dialog" className="wf-dialog" onDismiss={onCancel}>
      <h3 className="wf-dialog-title">Rename workflow</h3>
      <form
        className="wf-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <label className="wf-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="wf-dialog-actions">
          <button type="button" className="wf-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="wf-btn wf-btn-primary" data-testid="rename-save" disabled={!trimmed}>
            Save
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

function LastRun({ run }: { run: Run | undefined }) {
  if (!run) return <span className="wf-all-muted">Never run</span>;
  return <span style={{ color: RUN_STATE_COLOR[run.state] }}>{`${RUN_STATE_TEXT[run.state]} · ${run.id}`}</span>;
}

type Pending = { kind: "rename" | "delete"; workflow: WorkflowDef } | null;

/** The All workflows screen (board 11): search, the saved workflows as a table, New workflow, and per-row Edit / Run / Duplicate / Rename / Delete. */
export function AllWorkflows({
  workflows,
  runs,
  actions,
  onBack,
  onNew,
  onEdit,
  onRun,
}: {
  workflows: WorkflowDef[];
  runs: Run[];
  actions: WorkflowActions;
  onBack: () => void;
  onNew: () => void;
  onEdit: (workflow: WorkflowDef) => void;
  onRun: (workflow: WorkflowDef) => void;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? workflows.filter((w) => w.name.toLowerCase().includes(needle) || w.steps.some((s) => s.slug.toLowerCase().includes(needle)))
    : workflows;
  const lastRun = (w: WorkflowDef) => runs.filter((r) => r.workflowId === w.id).at(-1);

  const duplicate = (w: WorkflowDef) =>
    void actions.createWorkflow({ ...structuredClone(w), id: copyId(w.id, workflows.map((x) => x.id)), name: `${w.name} copy` });

  return (
    <div className="wf-all" data-testid="all-workflows">
      <div className="wf-all-head">
        <button type="button" className="wf-btn wf-btn-icon" aria-label="Back to runs" title="Back to runs" onClick={onBack}>
          <Icon name="back" />
        </button>
        <h3 className="wf-all-title">{`All workflows · ${workflows.length}`}</h3>
        <label className="wf-all-search">
          <Icon name="search" />
          <input type="search" placeholder="Search workflows" aria-label="Search workflows" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="wf-btn wf-btn-primary" data-testid="new-workflow" onClick={onNew}>
          <Icon name="plus" />
          New workflow
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="workflow-empty">{workflows.length ? "No workflow matches the search." : "No saved workflows. Use New workflow to create one."}</p>
      ) : (
        <div className="wf-all-scroll">
          <table className="wf-all-table" aria-label="Saved workflows">
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Steps</th>
                <th scope="col">Inputs</th>
                <th scope="col">Last run</th>
                <th scope="col">
                  <span className="wf-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => {
                const inputs = workflowInputs(w);
                return (
                  <tr key={w.id} data-testid={`all-row-${w.id}`}>
                    <th scope="row" className="wf-all-name">
                      <span className="wf-truncate" title={w.name}>
                        {w.name}
                      </span>
                    </th>
                    <td>
                      <ul className="wf-all-chips" aria-label={`Steps of ${w.name}`}>
                        {w.steps.map((s) => {
                          const mode = stepChipMode(s);
                          return (
                            <li key={s.id} className="wf-all-chip" data-mode={mode} title={`${s.slug}: ${CHIP_TEXT[mode]}`}>
                              {`${s.slug} · ${CHIP_TEXT[mode]}`}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td className="wf-all-muted">{inputs.length ? inputs.map((i) => i.label || i.name).join(", ") : "None"}</td>
                    <td>
                      <LastRun run={lastRun(w)} />
                    </td>
                    <td>
                      <div className="wf-run-actions">
                        <button type="button" className="wf-btn" aria-label={`Edit workflow ${w.name}`} onClick={() => onEdit(w)}>
                          <Icon name="edit" />
                          Edit
                        </button>
                        <button type="button" className="wf-btn wf-btn-primary" aria-label={`Start run: ${w.name}`} onClick={() => onRun(w)}>
                          <Icon name="play" />
                          Run
                        </button>
                        <OverflowMenu
                          label={`More actions for ${w.name}`}
                          items={[
                            { label: "Duplicate", icon: "copy", onSelect: () => duplicate(w) },
                            { label: "Rename", icon: "edit", onSelect: () => setPending({ kind: "rename", workflow: w }) },
                            { label: "Delete", icon: "trash", danger: true, onSelect: () => setPending({ kind: "delete", workflow: w }) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pending?.kind === "rename" && (
        <RenameDialog
          workflow={pending.workflow}
          onCancel={() => setPending(null)}
          onSave={(name) => {
            setPending(null);
            void actions.updateWorkflow({ ...pending.workflow, name });
          }}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          label="Delete workflow"
          message={`Delete "${pending.workflow.name}"? Its past runs stay in the run list.`}
          confirmLabel="Delete"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void actions.deleteWorkflow(pending.workflow.id);
          }}
        />
      )}
    </div>
  );
}
