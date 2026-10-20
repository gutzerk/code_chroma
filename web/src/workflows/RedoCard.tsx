import { useState } from "react";
import { computeRedoCard, isLaterThanSuggested } from "./redoPlan";
import type { RedoProposal, Run, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

/** The run agent's proposed redo: a step picker, the Reruns / Keeps / Sets aside lists, a note and an optional step edit. */
export function RedoCard({
  run,
  workflow,
  proposal,
  actions,
  from,
  onFromChange,
}: {
  run: Run;
  workflow: WorkflowDef;
  proposal: RedoProposal;
  actions: WorkflowActions;
  from: string;
  onFromChange: (stepId: string) => void;
}) {
  const [note, setNote] = useState(proposal.card.note);
  const [editFirst, setEditFirst] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const [saveToWorkflow, setSaveToWorkflow] = useState(false);
  const slugOf = (id: string): string => workflow.steps.find((s) => s.id === id)?.slug ?? id;
  const card = computeRedoCard(workflow, run, from, note);
  const later = isLaterThanSuggested(workflow, proposal.from, from);
  const prompt = editedPrompt ?? workflow.steps.find((s) => s.id === from)?.prompt ?? "";
  const list = (ids: string[]): string => (ids.length ? ids.map(slugOf).join(", ") : "none");

  const pick = (stepId: string): void => {
    setEditedPrompt(null);
    onFromChange(stepId);
  };

  return (
    <section className="redo-card" aria-label="Redo proposal" data-testid="redo-card">
      <h3 className="redo-title">{`Redo from ${slugOf(from)}`}</h3>
      <label className="redo-field">
        <span>Redo from</span>
        <select
          data-testid="redo-picker"
          value={from}
          onChange={(e) => pick(e.target.value)}
        >
          {workflow.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.slug}
            </option>
          ))}
        </select>
      </label>
      {later && (
        <p className="redo-warning" role="alert" data-testid="redo-warning">
          {`Later than suggested: the agent suggested ${slugOf(proposal.from)}, so ${list(
            workflow.steps
              .map((s) => s.id)
              .slice(
                workflow.steps.findIndex((s) => s.id === proposal.from),
                workflow.steps.findIndex((s) => s.id === from),
              ),
          )} will keep possibly stale output.`}
        </p>
      )}
      <dl className="redo-lists">
        <dt>Reruns</dt>
        <dd data-testid="redo-reruns">{list(card.reruns)}</dd>
        <dt>Keeps</dt>
        <dd data-testid="redo-keeps">{list(card.keeps)}</dd>
        <dt>Sets aside</dt>
        <dd data-testid="redo-sets-aside">{list(card.setsAside)}</dd>
      </dl>
      <label className="redo-field">
        <span>Note for the step</span>
        <textarea
          data-testid="redo-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="redo-check">
        <input
          type="checkbox"
          data-testid="redo-edit-first"
          checked={editFirst}
          onChange={(e) => setEditFirst(e.target.checked)}
        />
        <span>Edit step first</span>
      </label>
      {editFirst && (
        <div className="redo-edit">
          <textarea
            aria-label="Step prompt"
            data-testid="redo-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
          />
          <label className="redo-check">
            <input
              type="radio"
              name={`redo-scope-${run.id}`}
              checked={!saveToWorkflow}
              onChange={() => setSaveToWorkflow(false)}
            />
            <span>This run only</span>
          </label>
          <label className="redo-check">
            <input
              type="radio"
              name={`redo-scope-${run.id}`}
              data-testid="redo-save-workflow"
              checked={saveToWorkflow}
              onChange={() => setSaveToWorkflow(true)}
            />
            <span>Also save to workflow</span>
          </label>
        </div>
      )}
      <div className="redo-actions">
        <button
          type="button"
          className="workflow-header-button"
          data-testid="redo-confirm"
          onClick={() =>
            void actions.redo(run.id, {
              from,
              note: note.trim() || undefined,
              stepEdit: editFirst ? { prompt, saveToWorkflow } : undefined,
            })
          }
        >
          {`Redo from ${slugOf(from)}`}
        </button>
        <button
          type="button"
          className="workflow-header-button"
          data-testid="redo-cancel"
          onClick={() => void actions.cancelRedo(run.id)}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
