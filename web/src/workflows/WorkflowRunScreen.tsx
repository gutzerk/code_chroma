import { useEffect, useMemo, useState } from "react";
import "./workflows.css";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { RedoCard } from "./RedoCard";
import { RunChat } from "./RunChat";
import { RunOverview } from "./RunOverview";
import { StepRail } from "./StepRail";
import { stepsForAttempt } from "./redoPlan";
import { RUN_STATE_TEXT, STATUS_META, canStopRun, headerToggle, stateBanner } from "./runControls";
import {
  bindWorkflows,
  useActiveRunId,
  useExpandedStepId,
  useRailCollapsed,
  useRuns,
  useViewAttempt,
  useWorkflowError,
  useWorkflows,
  workflowActions,
  workflowStore,
} from "./workflowStore";

/** The run screen: header, attempt switcher, banner, step rail (or its one-line collapse), redo card, output pane and run chat. */
export function WorkflowRunScreen() {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const runs = useRuns();
  const activeRunId = useActiveRunId();
  const expandedStepId = useExpandedStepId();
  const error = useWorkflowError();
  const collapsed = useRailCollapsed();
  const viewAttempt = useViewAttempt();
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const actions = useMemo(() => workflowActions(client), [client]);

  useEffect(() => bindWorkflows(client), [client]);

  const run = runs.find((r) => r.id === activeRunId);
  const workflow = workflows.find((w) => w.id === run?.workflowId);
  const proposalFrom = run?.redoProposal?.from;
  useEffect(() => {
    setPickedFrom(null);
    if (proposalFrom) workflowStore.setRailCollapsed(false);
  }, [proposalFrom]);

  const stepLabel = (stepId: string | null): string =>
    workflow?.steps.find((s) => s.id === stepId)?.slug ?? "the run";

  const viewed = run && viewAttempt !== null && viewAttempt <= run.attempt ? viewAttempt : run?.attempt;
  const readOnly = run !== undefined && viewed !== undefined && viewed < run.attempt;
  const viewRun = useMemo(
    () =>
      run && workflow && viewed !== undefined
        ? { ...run, steps: stepsForAttempt(run, workflow, viewed) }
        : undefined,
    [run, workflow, viewed],
  );
  const proposal = readOnly ? null : (run?.redoProposal ?? null);
  const redoFrom = proposal ? (pickedFrom ?? proposal.from) : null;

  const shownStepId = expandedStepId ?? run?.currentStepId ?? null;
  const shownStep = viewRun?.steps.find((s) => s.stepId === shownStepId);
  const banner = run ? stateBanner(run, stepLabel) : null;
  const toggle = run ? headerToggle(run.state) : null;

  return (
    <section className="workflow-screen" aria-label="Workflow run" data-testid="workflow-screen">
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {!run || !viewRun || !workflow || !toggle ? (
        <div className="workflow-start" data-testid="workflow-start">
          <h2 className="workflow-title">Workflows</h2>
          {workflows.length === 0 && <p>No workflows defined in .codechroma/workflows.</p>}
          {workflows.map((w) => (
            <button
              key={w.id}
              type="button"
              className="workflow-start-button"
              onClick={() => void actions.start(w.id)}
            >
              {`Start run: ${w.name}`}
            </button>
          ))}
          <RunOverview runs={runs} workflows={workflows} onOpen={workflowStore.setActiveRun} />
        </div>
      ) : (
        <>
          <header className="workflow-header">
            <h2 className="workflow-title">{workflow.name}</h2>
            <span className="workflow-state" data-testid="run-state" data-state={run.state}>
              {RUN_STATE_TEXT[run.state]}
            </span>
            <div className="workflow-header-actions">
              <button
                type="button"
                className="workflow-header-button"
                data-testid="header-toggle"
                disabled={!toggle.enabled}
                onClick={() =>
                  void (run.state === "running" ? actions.pause(run.id) : actions.resume(run.id))
                }
              >
                {toggle.label}
              </button>
              <button
                type="button"
                className="workflow-header-button workflow-stop"
                data-testid="stop-run"
                disabled={!canStopRun(run.state)}
                onClick={() => void actions.stop(run.id, "now")}
              >
                Stop run
              </button>
              <button
                type="button"
                className="workflow-header-button"
                onClick={() => workflowStore.setActiveRun(null)}
              >
                All runs
              </button>
            </div>
          </header>
          {run.attempts.length > 1 && (
            <div
              className="attempt-switcher"
              role="group"
              aria-label="Attempts"
              data-testid="attempt-switcher"
            >
              {run.attempts.map((a) => (
                <button
                  key={a.n}
                  type="button"
                  className="workflow-header-button"
                  aria-pressed={a.n === viewed}
                  data-testid={`attempt-${a.n}`}
                  onClick={() => workflowStore.setViewAttempt(a.n === run.attempt ? null : a.n)}
                >
                  {`Attempt ${a.n}`}
                </button>
              ))}
            </div>
          )}
          {readOnly && (
            <p className="workflow-banner" role="status" data-testid="attempt-readonly">
              {`Attempt ${viewed} is read-only. It was set aside by a redo.`}
            </p>
          )}
          {banner && (
            <p className="workflow-banner" role="status" data-testid="run-banner">
              {banner}
            </p>
          )}
          <div className="workflow-body">
            {collapsed ? (
              <button
                type="button"
                className="step-rail-collapsed"
                data-testid="step-rail-collapsed"
                aria-expanded={false}
                onClick={() => workflowStore.setRailCollapsed(false)}
              >
                {`${viewRun.steps
                  .map((st) => `${stepLabel(st.stepId)} ${STATUS_META[st.status].icon}`)
                  .join("  ")} - show steps`}
              </button>
            ) : (
              <StepRail
                run={viewRun}
                workflow={workflow}
                actions={actions}
                expandedStepId={expandedStepId}
                onToggle={workflowStore.toggleExpanded}
                readOnly={readOnly}
                rerunFrom={redoFrom}
              />
            )}
            {proposal && redoFrom && (
              <RedoCard
                run={run}
                workflow={workflow}
                proposal={proposal}
                actions={actions}
                from={redoFrom}
                onFromChange={setPickedFrom}
              />
            )}
            <div
              className="workflow-output"
              role="log"
              aria-label="Step output"
              data-testid="step-output"
            >
              {shownStep ? (
                <>
                  <h3 className="workflow-output-title">{stepLabel(shownStep.stepId)}</h3>
                  <pre className="workflow-output-text">{shownStep.output || "No output yet."}</pre>
                  {shownStep.diffStat && <p className="workflow-diffstat">{shownStep.diffStat}</p>}
                </>
              ) : (
                <p>Select a step to see its output.</p>
              )}
            </div>
          </div>
          <RunChat run={run} workflow={workflow} actions={actions} />
        </>
      )}
    </section>
  );
}
