import { RUN_STATE_COLOR, RUN_STATE_TEXT, STATUS_META } from "./runControls";
import type { Run, WorkflowDef } from "./types";

/** Every run with its workflow, state, stage bar and attempts (the W3 list); picking one opens its run screen. */
export function RunOverview({
  runs,
  workflows,
  onOpen,
}: {
  runs: Run[];
  workflows: WorkflowDef[];
  onOpen: (runId: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <ul className="run-overview" aria-label="Runs" data-testid="run-overview">
      {runs.map((run) => {
        const workflow = workflows.find((w) => w.id === run.workflowId);
        const name = workflow?.name ?? run.workflowId;
        const finished = run.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
        const current = run.steps.find((s) => s.stepId === run.currentStepId);
        const stage = current
          ? `${workflow?.steps.find((s) => s.id === current.stepId)?.slug ?? current.stepId} · ${STATUS_META[current.status].text}`
          : run.state === "done"
            ? "All steps finished"
            : "";
        return (
          <li
            key={run.id}
            className="run-overview-row"
            data-testid={`run-row-${run.id}`}
            data-state={run.state}
            style={{ borderLeftColor: RUN_STATE_COLOR[run.state] }}
          >
            <button
              type="button"
              className="run-overview-open"
              onClick={() => onOpen(run.id)}
            >
              {`Open run ${run.id} (${RUN_STATE_TEXT[run.state]})`}
            </button>
            <span className="run-overview-name">{name}</span>
            <span className="run-overview-stage" style={{ color: RUN_STATE_COLOR[run.state] }}>
              {`${RUN_STATE_TEXT[run.state]}${stage ? ` · ${stage}` : ""}`}
            </span>
            <div
              className="workflow-progress"
              role="progressbar"
              aria-label={`Progress of ${run.id}`}
              aria-valuemin={0}
              aria-valuemax={run.steps.length}
              aria-valuenow={finished}
            >
              {run.steps.map((step) => (
                <span
                  key={step.stepId}
                  data-status={step.status}
                  title={`${workflow?.steps.find((s) => s.id === step.stepId)?.slug ?? step.stepId}: ${STATUS_META[step.status].text}`}
                />
              ))}
            </div>
            <ul className="run-overview-attempts" aria-label={`Attempts of ${run.id}`}>
              {run.attempts.map((a) => (
                <li key={a.n} data-testid={`run-attempt-${run.id}-${a.n}`}>
                  {a.branch ? `Attempt ${a.n} (set aside on ${a.branch})` : `Attempt ${a.n}`}
                  {a.n === run.attempt ? " - current" : ""}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
