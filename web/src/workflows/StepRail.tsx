import { useState } from "react";
import type { Run, StepRecord, WorkflowDef } from "./types";
import {
  ACTION_LABEL,
  STATUS_META,
  showBreakpointToggle,
  stepActions,
  type StepAction,
} from "./runControls";
import type { WorkflowActions } from "./workflowStore";

/** Runs the action a row control names against the run. */
function perform(
  actions: WorkflowActions,
  run: Run,
  step: StepRecord,
  action: StepAction,
  note: string,
): void {
  switch (action) {
    case "stopAfter":
      return void actions.stop(run.id, "afterStep");
    case "keepRunning":
      return void actions.keepRunning(run.id);
    case "resume":
    case "continue":
      return void actions.resume(run.id);
    case "resumeFrom":
      return void actions.resumeFrom(run.id, step.stepId);
    case "approve":
      return void actions.review(run.id, "approve");
    case "sendBack":
      return void actions.review(run.id, "sendBack", note.trim() || undefined);
  }
}

/** The expanded row's controls; a review step also gets the Send-back note field. */
function StepControls({
  run,
  step,
  def,
  slug,
  panelId,
  actions,
  rowActions,
}: {
  run: Run;
  step: StepRecord;
  def: WorkflowDef["steps"][number] | undefined;
  slug: string;
  panelId: string;
  actions: WorkflowActions;
  rowActions: StepAction[];
}) {
  const [note, setNote] = useState("");
  return (
    <div id={panelId} className="step-controls" role="group" aria-label={`${slug} controls`}>
      {def && <p className="step-prompt">{def.prompt}</p>}
      {rowActions.length === 0 && <p className="step-none">No actions right now.</p>}
      {step.status === "needs_you" && (
        <label className="step-note">
          <span>Send-back note</span>
          <textarea
            data-testid={`sendback-note-${slug}`}
            value={note}
            rows={2}
            placeholder="What should change?"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
      {rowActions.map((action) => (
        <button
          key={action}
          type="button"
          className="step-action"
          data-testid={`action-${action}-${slug}`}
          aria-label={`${ACTION_LABEL[action]}: ${slug}`}
          onClick={() => perform(actions, run, step, action, note)}
        >
          {ACTION_LABEL[action]}
        </button>
      ))}
    </div>
  );
}

/** The run steps as a rail: status as icon + text, a breakpoint gutter on unstarted steps, one expanded row. */
export function StepRail({
  run,
  workflow,
  actions,
  expandedStepId,
  onToggle,
  readOnly = false,
  rerunFrom = null,
}: {
  run: Run;
  workflow: WorkflowDef;
  actions: WorkflowActions;
  expandedStepId: string | null;
  onToggle: (stepId: string) => void;
  /** An earlier attempt: no breakpoints or step actions. */
  readOnly?: boolean;
  /** While a redo card is open, the step it would restart from; that row and later ones will rerun. */
  rerunFrom?: string | null;
}) {
  const rerunIndex = rerunFrom === null ? -1 : workflow.steps.findIndex((s) => s.id === rerunFrom);
  return (
    <ol className="step-rail" aria-label="Workflow steps" data-testid="step-rail">
      {run.steps.map((step) => {
        const defIndex = workflow.steps.findIndex((s) => s.id === step.stepId);
        const willRerun = rerunIndex >= 0 && defIndex >= rerunIndex;
        const def = workflow.steps[defIndex];
        const slug = def?.slug ?? step.stepId;
        const expanded = expandedStepId === step.stepId;
        const hasBreakpoint = run.breakpoints.includes(step.stepId);
        const rowActions = readOnly ? [] : stepActions(run, step);
        const panelId = `step-panel-${run.id}-${step.stepId}`;
        return (
          <li
            key={step.stepId}
            className="step-row"
            data-testid={`step-row-${slug}`}
            data-status={step.status}
            data-current={(!readOnly && run.currentStepId === step.stepId) || undefined}
            data-will-rerun={willRerun || undefined}
          >
            <div className="step-row-line">
              {!readOnly && showBreakpointToggle(step) ? (
                <button
                  type="button"
                  className="step-gutter"
                  data-testid={`breakpoint-${slug}`}
                  aria-pressed={hasBreakpoint}
                  aria-label={`Breakpoint before ${slug}`}
                  onClick={() => void actions.setBreakpoint(run.id, step.stepId, !hasBreakpoint)}
                >
                  <span aria-hidden="true" className="step-gutter-dot" data-set={hasBreakpoint} />
                </button>
              ) : (
                <span className="step-gutter step-gutter-idle" aria-hidden="true" />
              )}
              <button
                type="button"
                className="step-head"
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-label={`${slug}, ${STATUS_META[step.status].text}`}
                onClick={() => onToggle(step.stepId)}
              >
                <span className="step-icon" aria-hidden="true">
                  {STATUS_META[step.status].icon}
                </span>
                <span className="step-slug">{slug}</span>
                <span className="step-status">{STATUS_META[step.status].text}</span>
                {step.diffStat && <span className="step-diff-summary">{step.diffStat}</span>}
                {step.fromAttempt !== undefined && (
                  <span className="step-tag step-tag-kept" data-testid={`kept-${slug}`}>
                    {`from attempt ${step.fromAttempt}`}
                  </span>
                )}
                {willRerun && (
                  <span className="step-tag step-tag-rerun" data-testid={`will-rerun-${slug}`}>
                    {"↻ Will rerun"}
                  </span>
                )}
                {willRerun && def?.kind === "agent" && (
                  <span className="step-tag step-tag-redraw" data-testid={`will-redraw-${slug}`}>
                    will redraw
                  </span>
                )}
              </button>
            </div>
            {expanded && (
              <StepControls
                run={run}
                step={step}
                def={def}
                slug={slug}
                panelId={panelId}
                actions={actions}
                rowActions={rowActions}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
