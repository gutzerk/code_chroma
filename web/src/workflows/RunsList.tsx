import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import {
  CONFIRM_MESSAGES,
  RUN_STATE_COLOR,
  RUN_STATE_TEXT,
  STATUS_META,
  isFinished,
  stepPosition,
  type PanelLayout,
} from "./runControls";
import type { Run, StepRecord, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

/** A segmented progress bar, one segment per step. */
function SegmentBar({
  steps,
  label,
  slugOf,
}: {
  steps: StepRecord[];
  label: string;
  slugOf: (stepId: string) => string;
}) {
  const finished = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return (
    <span className="wf-seg" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished}>
      {steps.map((step) => (
        <span key={step.stepId} data-status={step.status} title={`${slugOf(step.stepId)}: ${STATUS_META[step.status].text}`} />
      ))}
    </span>
  );
}

/** The run's attempts, one line each, when a redo has set earlier ones aside. */
function Attempts({ run }: { run: Run }) {
  if (run.attempts.length < 2) return null;
  return (
    <span className="wf-attempts" aria-label={`Attempts of ${run.id}`}>
      {run.attempts.map((a) => (
        <span key={a.n} className="wf-truncate" data-testid={`run-attempt-${run.id}-${a.n}`}>
          {a.branch ? `Attempt ${a.n} (set aside on ${a.branch})` : `Attempt ${a.n}`}
          {a.n === run.attempt ? " - current" : ""}
        </span>
      ))}
    </span>
  );
}

function runName(run: Run, workflow: WorkflowDef | undefined): string {
  return workflow?.name ?? run.workflowId;
}

function stageText(run: Run): string {
  const { index, total } = stepPosition(run);
  if (run.state === "stopped") return `Stopped at ${index} of ${total}`;
  if (run.state === "done") return "Done";
  return `${RUN_STATE_TEXT[run.state]} · step ${index} of ${total}`;
}

/** One live run: name with its state mark, "Running · step 2 of 4" and the segmented progress bar. */
function ActiveCard({
  run,
  workflow,
  selected,
  onOpen,
}: {
  run: Run;
  workflow: WorkflowDef | undefined;
  selected: boolean;
  onOpen: (runId: string) => void;
}) {
  const name = runName(run, workflow);
  return (
    <li data-testid={`run-row-${run.id}`}>
      <button
        type="button"
        className="wf-run-card"
        data-state={run.state}
        aria-label={`Open run ${run.id} (${RUN_STATE_TEXT[run.state]})`}
        aria-current={selected || undefined}
        onClick={() => onOpen(run.id)}
      >
        <span className="wf-run-top">
          <span className="wf-run-name wf-truncate" title={name}>
            {name}
          </span>
          {run.state === "needs_you" ? (
            <span className="wf-run-alert" aria-hidden="true">
              !
            </span>
          ) : (
            <span className="wf-run-dot" aria-hidden="true" style={{ background: RUN_STATE_COLOR[run.state] }} />
          )}
        </span>
        <span className="wf-run-stage" style={{ color: run.state === "running" ? undefined : RUN_STATE_COLOR[run.state] }}>
          {stageText(run)}
        </span>
        <SegmentBar steps={run.steps} label={`Progress of ${run.id}`} slugOf={(id) => workflow?.steps.find((s) => s.id === id)?.slug ?? id} />
        <Attempts run={run} />
      </button>
    </li>
  );
}

/** One finished run: a done check or stopped square, name, outcome; restart and delete sit inline outside the side layout. */
function FinishedRow({
  run,
  workflow,
  selected,
  inlineActions,
  onOpen,
  onRestart,
  onDelete,
}: {
  run: Run;
  workflow: WorkflowDef | undefined;
  selected: boolean;
  inlineActions: boolean;
  onOpen: (runId: string) => void;
  onRestart: (run: Run) => void;
  onDelete: (run: Run) => void;
}) {
  const name = runName(run, workflow);
  return (
    <li className="wf-finished-row" data-testid={`run-row-${run.id}`} data-state={run.state} data-selected={selected || undefined}>
      <button
        type="button"
        className="wf-finished-open"
        aria-label={`Open run ${run.id} (${RUN_STATE_TEXT[run.state]})`}
        aria-current={selected || undefined}
        onClick={() => onOpen(run.id)}
      >
        <span className="wf-finished-mark" role="img" aria-label={RUN_STATE_TEXT[run.state]} data-state={run.state}>
          {run.state === "done" ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          ) : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
            </svg>
          )}
        </span>
        <span className="wf-finished-text">
          <span className="wf-finished-name wf-truncate" title={name}>
            {name}
          </span>
          <span className="wf-finished-sub wf-truncate">{stageText(run)}</span>
        </span>
      </button>
      {inlineActions && (
        <>
          <button type="button" className="wf-icon-btn" aria-label={`Restart run ${run.id}`} title="Restart run" onClick={() => onRestart(run)}>
            <Icon name="restart" size={14} />
          </button>
          <button type="button" className="wf-icon-btn" aria-label={`Delete run ${run.id}`} title="Delete run" onClick={() => onDelete(run)}>
            <Icon name="trash" size={14} />
          </button>
        </>
      )}
    </li>
  );
}

type Pending = { kind: "restart"; run: Run } | { kind: "deleteRun"; run: Run } | { kind: "clear" };

/** The run overview: Active runs as cards, Finished runs as compact rows (restart, delete, clear). */
export function RunsList({
  runs,
  workflows,
  activeRunId,
  layout,
  actions,
  onOpen,
}: {
  runs: Run[];
  workflows: WorkflowDef[];
  activeRunId: string | null;
  layout: PanelLayout;
  actions: WorkflowActions;
  onOpen: (runId: string) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const active = runs.filter((r) => !isFinished(r.state));
  const finished = runs.filter((r) => isFinished(r.state));
  const find = (run: Run) => workflows.find((w) => w.id === run.workflowId);

  const confirm = (): { label: string; message: string; confirmLabel: string; run: () => void } | null => {
    if (!pending) return null;
    switch (pending.kind) {
      case "restart":
        return { label: "Restart run", message: CONFIRM_MESSAGES.restart, confirmLabel: "Restart", run: () => void actions.restart(pending.run.id) };
      case "deleteRun":
        return { label: "Delete run", message: CONFIRM_MESSAGES.deleteRun(pending.run.id), confirmLabel: "Delete", run: () => void actions.deleteRun(pending.run.id) };
      case "clear":
        return { label: "Clear finished", message: "Delete every finished run?", confirmLabel: "Clear", run: () => void actions.clearFinished() };
    }
  };
  const dialog = confirm();

  return (
    <div className="wf-lists" data-testid="run-overview">
      <section aria-labelledby="wf-active-h">
        <h3 id="wf-active-h" className="workflow-list-heading">{`Active · ${active.length}`}</h3>
        {active.length === 0 ? (
          <p className="workflow-empty">No active runs.</p>
        ) : (
          <ul className="wf-run-list" aria-label="Active runs">
            {active.map((run) => (
              <ActiveCard key={run.id} run={run} workflow={find(run)} selected={run.id === activeRunId} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="wf-finished-h">
        <div className="wf-section-head">
          <h3 id="wf-finished-h" className="workflow-list-heading">{`Finished · ${finished.length}`}</h3>
          {finished.length > 0 && (
            <button type="button" className="wf-clear" data-testid="clear-finished" onClick={() => setPending({ kind: "clear" })}>
              {layout === "full" ? "Clear finished" : "Clear"}
            </button>
          )}
        </div>
        {finished.length === 0 ? (
          <p className="workflow-empty">Nothing finished yet.</p>
        ) : (
          <ul className="wf-finished-list" aria-label="Finished runs">
            {finished.map((run) => (
              <FinishedRow
                key={run.id}
                run={run}
                workflow={find(run)}
                selected={run.id === activeRunId}
                inlineActions={layout !== "side"}
                onOpen={onOpen}
                onRestart={(r) => setPending({ kind: "restart", run: r })}
                onDelete={(r) => setPending({ kind: "deleteRun", run: r })}
              />
            ))}
          </ul>
        )}
      </section>
      {dialog && (
        <ConfirmDialog
          label={dialog.label}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            dialog.run();
          }}
        />
      )}
    </div>
  );
}
