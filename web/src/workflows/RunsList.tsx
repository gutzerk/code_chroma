import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
import {
  CONFIRM_MESSAGES,
  RUN_STATE_COLOR,
  RUN_STATE_TEXT,
  STATUS_META,
  canStopRun,
  headerToggle,
  isFinished,
  type PanelLayout,
} from "./runControls";
import type { Run, StepRecord, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

/** A segmented progress bar, one segment per step. */
export function SegmentBar({
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
    <div className="wf-seg" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished}>
      {steps.map((step) => (
        <span key={step.stepId} data-status={step.status} title={`${slugOf(step.stepId)}: ${STATUS_META[step.status].text}`} />
      ))}
    </div>
  );
}

/** The run's attempts, one line each, when a redo has set earlier ones aside. */
function Attempts({ run }: { run: Run }) {
  if (run.attempts.length < 2) return null;
  return (
    <ul className="wf-attempts" aria-label={`Attempts of ${run.id}`}>
      {run.attempts.map((a) => (
        <li key={a.n} className="wf-truncate" data-testid={`run-attempt-${run.id}-${a.n}`}>
          {a.branch ? `Attempt ${a.n} (set aside on ${a.branch})` : `Attempt ${a.n}`}
          {a.n === run.attempt ? " - current" : ""}
        </li>
      ))}
    </ul>
  );
}

function stageText(run: Run, workflow: WorkflowDef | undefined): string {
  const current = run.steps.find((s) => s.stepId === run.currentStepId);
  if (!current) return run.state === "done" ? "All steps finished" : "";
  const slug = workflow?.steps.find((s) => s.id === current.stepId)?.slug ?? current.stepId;
  return `${slug} · ${STATUS_META[current.status].text}`;
}

/** The part of a run row that opens the run; name and stage truncate with an ellipsis. */
function RunHead({
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
  const name = workflow?.name ?? run.workflowId;
  const stage = stageText(run, workflow);
  return (
    <button
      type="button"
      className="wf-run-open"
      aria-label={`Open run ${run.id} (${RUN_STATE_TEXT[run.state]})`}
      aria-current={selected || undefined}
      onClick={() => onOpen(run.id)}
    >
      <span className="wf-run-name wf-truncate" title={name}>
        {name}
      </span>
      <span className="wf-run-stage wf-truncate" style={{ color: RUN_STATE_COLOR[run.state] }} title={stage}>
        {`${RUN_STATE_TEXT[run.state]}${stage ? ` · ${stage}` : ""}`}
      </span>
    </button>
  );
}

/** Opens the card unless the click landed on one of its own controls. */
function openOnBackgroundClick(open: () => void) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, [role='menu'], [role='menuitem']")) return;
    open();
  };
}

function ActiveCard({
  run,
  workflow,
  selected,
  layout,
  actions,
  onOpen,
}: {
  run: Run;
  workflow: WorkflowDef | undefined;
  selected: boolean;
  layout: PanelLayout;
  actions: WorkflowActions;
  onOpen: (runId: string) => void;
}) {
  const toggle = headerToggle(run.state);
  const running = run.state === "running";
  const secondary: MenuItem[] = [
    { label: "Stop", icon: "stop", disabled: !running, onSelect: () => void actions.stop(run.id, "afterStep") },
    { label: "Cancel run", icon: "cancel", danger: true, disabled: !canStopRun(run.state), onSelect: () => void actions.stop(run.id, "now") },
  ];
  return (
    <li className="wf-run-card wf-run-clickable" onClick={openOnBackgroundClick(() => onOpen(run.id))} data-testid={`run-row-${run.id}`} data-state={run.state} data-selected={selected || undefined} style={{ borderLeftColor: RUN_STATE_COLOR[run.state] }}>
      <RunHead run={run} workflow={workflow} selected={selected} onOpen={onOpen} />
      <SegmentBar
        steps={run.steps}
        label={`Progress of ${run.id}`}
        slugOf={(id) => workflow?.steps.find((s) => s.id === id)?.slug ?? id}
      />
      <Attempts run={run} />
      <div className="wf-run-actions">
        {run.state === "needs_you" ? (
          <button type="button" className="wf-btn wf-btn-primary" data-testid={`review-now-${run.id}`} onClick={() => onOpen(run.id)}>
            <Icon name="alert" />
            Review now
          </button>
        ) : (
          <button
            type="button"
            className="wf-btn"
            data-testid={`toggle-${run.id}`}
            disabled={!toggle.enabled}
            onClick={() => void (running ? actions.pause(run.id) : actions.resume(run.id))}
          >
            <Icon name={running ? "pause" : "play"} />
            {toggle.label}
          </button>
        )}
        {layout === "narrow" ? (
          <OverflowMenu items={secondary} />
        ) : (
          <>
            <button type="button" className="wf-btn" disabled={!running} onClick={() => void actions.stop(run.id, "afterStep")}>
              <Icon name="stop" />
              Stop
            </button>
            <button type="button" className="wf-btn wf-btn-danger" disabled={!canStopRun(run.state)} onClick={() => void actions.stop(run.id, "now")}>
              Cancel run
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function FinishedRow({
  run,
  workflow,
  selected,
  layout,
  onOpen,
  onRestart,
  onDelete,
}: {
  run: Run;
  workflow: WorkflowDef | undefined;
  selected: boolean;
  layout: PanelLayout;
  onOpen: (runId: string) => void;
  onRestart: (run: Run) => void;
  onDelete: (run: Run) => void;
}) {
  return (
    <li className="wf-run-card wf-run-finished wf-run-clickable" onClick={openOnBackgroundClick(() => onOpen(run.id))} data-testid={`run-row-${run.id}`} data-state={run.state} data-selected={selected || undefined} style={{ borderLeftColor: RUN_STATE_COLOR[run.state] }}>
      <RunHead run={run} workflow={workflow} selected={selected} onOpen={onOpen} />
      <Attempts run={run} />
      <div className="wf-run-actions">
        <button type="button" className="wf-btn" aria-label={`Restart run ${run.id}`} onClick={() => onRestart(run)}>
          <Icon name="restart" />
          Restart
        </button>
        {layout === "narrow" ? (
          <OverflowMenu items={[{ label: "Delete", icon: "trash", danger: true, onSelect: () => onDelete(run) }]} />
        ) : (
          <button type="button" className="wf-btn wf-btn-danger" aria-label={`Delete run ${run.id}`} onClick={() => onDelete(run)}>
            <Icon name="trash" />
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

type Pending =
  | { kind: "restart"; run: Run }
  | { kind: "deleteRun"; run: Run }
  | { kind: "clear" };

/** The sectioned lists: Active runs and Finished runs (restart/delete/clear), then the button to the All workflows screen. */
export function RunsList({
  runs,
  workflows,
  activeRunId,
  layout,
  actions,
  onOpen,
  onAllWorkflows,
}: {
  runs: Run[];
  workflows: WorkflowDef[];
  activeRunId: string | null;
  layout: PanelLayout;
  actions: WorkflowActions;
  onOpen: (runId: string) => void;
  onAllWorkflows: () => void;
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
        return { label: "Delete run", message: `Delete run ${pending.run.id}? Its worktree and result are removed.`, confirmLabel: "Delete", run: () => void actions.deleteRun(pending.run.id) };
      case "clear":
        return { label: "Clear finished", message: "Delete every finished run?", confirmLabel: "Clear", run: () => void actions.clearFinished() };
    }
  };
  const dialog = confirm();

  return (
    <div className="wf-lists" data-testid="run-overview">
      <section aria-labelledby="wf-active-h">
        <h3 id="wf-active-h" className="workflow-list-heading">{`Active (${active.length})`}</h3>
        {active.length === 0 ? (
          <p className="workflow-empty">No active runs.</p>
        ) : (
          <ul className="wf-run-list" aria-label="Active runs">
            {active.map((run) => (
              <ActiveCard key={run.id} run={run} workflow={find(run)} selected={run.id === activeRunId} layout={layout} actions={actions} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="wf-finished-h">
        <div className="wf-section-head">
          <h3 id="wf-finished-h" className="workflow-list-heading">{`Finished (${finished.length})`}</h3>
          {finished.length > 0 && (
            <button type="button" className="wf-btn" data-testid="clear-finished" onClick={() => setPending({ kind: "clear" })}>
              Clear finished
            </button>
          )}
        </div>
        {finished.length === 0 ? (
          <p className="workflow-empty">Nothing finished yet.</p>
        ) : (
          <ul className="wf-run-list" aria-label="Finished runs">
            {finished.map((run) => (
              <FinishedRow
                key={run.id}
                run={run}
                workflow={find(run)}
                selected={run.id === activeRunId}
                layout={layout}
                onOpen={onOpen}
                onRestart={(r) => setPending({ kind: "restart", run: r })}
                onDelete={(r) => setPending({ kind: "deleteRun", run: r })}
              />
            ))}
          </ul>
        )}
      </section>
      <button type="button" className="wf-btn wf-all-open" data-testid="all-workflows-open" onClick={onAllWorkflows}>
        <Icon name="list" />
        <span className="wf-truncate">{`All workflows · ${workflows.length}`}</span>
        <Icon name="chevron-right" />
      </button>
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
