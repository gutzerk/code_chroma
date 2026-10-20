import { RUN_STATE_TEXT } from "./runControls";
import type { Run, WorkflowDef } from "./types";

/** Every run with its workflow, state and attempts (the W3 list); picking one opens its run screen. */
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
        const name = workflows.find((w) => w.id === run.workflowId)?.name ?? run.workflowId;
        return (
          <li key={run.id} className="run-overview-row" data-testid={`run-row-${run.id}`}>
            <button
              type="button"
              className="workflow-start-button"
              onClick={() => onOpen(run.id)}
            >
              {`Open run ${run.id} (${RUN_STATE_TEXT[run.state]})`}
            </button>
            <span className="run-overview-name">{name}</span>
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
