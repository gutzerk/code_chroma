import { useEffect, useMemo, useState } from "react";
import "./workflows.css";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { SegmentBar } from "./RunsList";
import { Icon } from "./icons";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
import { RedoCard } from "./RedoCard";
import { RunChat } from "./RunChat";
import { StepRail } from "./StepRail";
import { stepsForAttempt } from "./redoPlan";
import {
  CONFIRM_MESSAGES,
  RUN_STATE_TEXT,
  STATUS_META,
  canStopRun,
  headerToggle,
  isFinished,
  stateBanner,
  type PanelLayout,
} from "./runControls";
import {
  useExpandedStepId,
  useRailCollapsed,
  useRuns,
  useViewAttempt,
  useWorkflows,
  workflowActions,
  workflowStore,
} from "./workflowStore";
import type { Run, StepRecord, WorkflowDef } from "./types";

type LiveTab = "agent" | "output" | "diff";
const LIVE_TABS: { id: LiveTab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "output", label: "Output" },
  { id: "diff", label: "Diff" },
];

/** The shown step, live: Agent / Output / Diff tabs (the full-screen third column). */
function LiveView({ run, workflow, step }: { run: Run; workflow: WorkflowDef; step: StepRecord | undefined }) {
  const [tab, setTab] = useState<LiveTab>("output");
  const def = workflow.steps.find((s) => s.id === step?.stepId);
  const messages = (run.messages ?? []).filter((m) => m.target === step?.stepId);
  return (
    <div className="wf-live" data-testid="live-view">
      <div className="wf-tabs" role="tablist" aria-label="Live view">
        {LIVE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="wf-tab"
            aria-selected={tab === t.id}
            data-testid={`live-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="workflow-output" role="log" aria-label="Step output" data-testid="step-output">
        {!step || !def ? (
          <p>Select a step to see it live.</p>
        ) : tab === "agent" ? (
          <>
            <h3 className="workflow-output-title">{def.slug}</h3>
            <p className="step-skill">{`${STATUS_META[step.status].text}${def.skill ? ` · Skill: ${def.skill}` : ""}`}</p>
            {def.prompt && <p className="step-prompt">{def.prompt}</p>}
            {messages.map((m) => (
              <p key={m.id} className="step-prompt">{`${m.role}: ${m.text}`}</p>
            ))}
          </>
        ) : tab === "output" ? (
          <>
            <h3 className="workflow-output-title">{def.slug}</h3>
            <pre className="workflow-output-text">{step.output || "No output yet."}</pre>
          </>
        ) : (
          <>
            <h3 className="workflow-output-title">{def.slug}</h3>
            <p className="workflow-diffstat">{step.diffStat ?? "No changes yet."}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** One run in full: header controls, attempts, banner, step timeline, redo card, output and chat. */
export function RunDetail({
  runId,
  layout,
  onBack,
}: {
  runId: string;
  layout: PanelLayout;
  onBack?: () => void;
}) {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const runs = useRuns();
  const expandedStepId = useExpandedStepId();
  const collapsed = useRailCollapsed();
  const viewAttempt = useViewAttempt();
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const actions = useMemo(() => workflowActions(client), [client]);

  const run = runs.find((r) => r.id === runId);
  const workflow = workflows.find((w) => w.id === run?.workflowId);
  const proposalFrom = run?.redoProposal?.from;
  useEffect(() => {
    setPickedFrom(null);
    if (proposalFrom) workflowStore.setRailCollapsed(false);
  }, [proposalFrom]);

  const viewed = run && viewAttempt !== null && viewAttempt <= run.attempt ? viewAttempt : run?.attempt;
  const readOnly = run !== undefined && viewed !== undefined && viewed < run.attempt;
  const viewRun = useMemo(
    () =>
      run && workflow && viewed !== undefined
        ? { ...run, steps: stepsForAttempt(run, workflow, viewed) }
        : undefined,
    [run, workflow, viewed],
  );
  if (!run || !viewRun || !workflow) {
    return (
      <p className="workflow-empty" data-testid="run-detail-empty">
        Select a run to see its steps.
      </p>
    );
  }

  const stepLabel = (stepId: string | null): string =>
    workflow.steps.find((s) => s.id === stepId)?.slug ?? "the run";
  const proposal = readOnly ? null : (run.redoProposal ?? null);
  const redoFrom = proposal ? (pickedFrom ?? proposal.from) : null;
  const shownStepId = expandedStepId ?? run.currentStepId ?? null;
  const shownStep = viewRun.steps.find((s) => s.stepId === shownStepId);
  const banner = stateBanner(run, stepLabel);
  const toggle = headerToggle(run.state);
  const running = run.state === "running";
  const full = layout === "full";
  const narrow = layout === "narrow";
  const stopAfterToggle = () =>
    void (run.stopAfter ? actions.keepRunning(run.id) : actions.stop(run.id, "afterStep"));

  const secondary: MenuItem[] = [
    { label: run.stopAfter ? "Keep running" : "Stop after step", icon: "stop", disabled: !running, onSelect: stopAfterToggle },
    { label: "Restart", icon: "restart", disabled: !isFinished(run.state), onSelect: () => setConfirmRestart(true) },
    { label: "Cancel run", icon: "cancel", danger: true, disabled: !canStopRun(run.state), onSelect: () => void actions.stop(run.id, "now") },
  ];

  const timeline = collapsed ? (
    <button
      type="button"
      className="step-rail-collapsed"
      data-testid="step-rail-collapsed"
      aria-expanded={false}
      onClick={() => workflowStore.setRailCollapsed(false)}
    >
      {viewRun.steps.map((st) => (
        <span key={st.stepId} className="step-collapsed-item">
          <Icon name={STATUS_META[st.status].icon} />
          {stepLabel(st.stepId)}
        </span>
      ))}
      <span className="step-collapsed-show">Show steps</span>
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
  );

  return (
    <section className="workflow-screen" aria-label="Workflow run" data-testid="workflow-screen" data-layout={layout}>
      <header className="workflow-header">
        {onBack && (
          <button type="button" className="wf-btn wf-btn-icon" aria-label="All workflow runs" data-testid="run-back" onClick={onBack}>
            <Icon name="back" />
          </button>
        )}
        <h2 className="workflow-title wf-truncate" title={workflow.name}>
          {workflow.name}
        </h2>
        <span className="workflow-state" data-testid="run-state" data-state={run.state}>
          {RUN_STATE_TEXT[run.state]}
        </span>
        <div className="workflow-header-actions">
          <button
            type="button"
            className="wf-btn"
            data-testid="header-toggle"
            disabled={!toggle.enabled}
            onClick={() => void (running ? actions.pause(run.id) : actions.resume(run.id))}
          >
            <Icon name={running ? "pause" : "play"} />
            {toggle.label}
          </button>
          {narrow ? (
            <OverflowMenu items={secondary} />
          ) : (
            <>
              <button type="button" className="wf-btn" data-testid="stop-after" disabled={!running} onClick={stopAfterToggle}>
                {run.stopAfter ? "Keep running" : "Stop after step"}
              </button>
              <button type="button" className="wf-btn" data-testid="restart-run" disabled={!isFinished(run.state)} onClick={() => setConfirmRestart(true)}>
                <Icon name="restart" />
                Restart
              </button>
              <button type="button" className="wf-btn wf-btn-danger" data-testid="cancel-run" disabled={!canStopRun(run.state)} onClick={() => void actions.stop(run.id, "now")}>
                Cancel
              </button>
            </>
          )}
        </div>
      </header>
      {run.attempts.length > 1 && (
        <div className="attempt-switcher" role="group" aria-label="Attempts" data-testid="attempt-switcher">
          {run.attempts.map((a) => (
            <button
              key={a.n}
              type="button"
              className="wf-btn"
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
      <SegmentBar steps={viewRun.steps} label="Workflow progress" slugOf={stepLabel} />
      {!collapsed && (
        <button type="button" className="workflow-collapse-steps wf-btn" onClick={() => workflowStore.setRailCollapsed(true)}>
          <Icon name="chevron-up" />
          Hide steps
        </button>
      )}
      <div className="workflow-body" data-full={full || undefined}>
        <div className="wf-timeline-col">
          {timeline}
          {proposal && redoFrom && (
            <RedoCard run={run} workflow={workflow} proposal={proposal} actions={actions} from={redoFrom} onFromChange={setPickedFrom} />
          )}
        </div>
        {full ? (
          <LiveView run={run} workflow={workflow} step={shownStep} />
        ) : (
          <div className="workflow-output" role="log" aria-label="Step output" data-testid="step-output">
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
        )}
      </div>
      <RunChat run={run} workflow={workflow} actions={actions} />
      {confirmRestart && (
        <ConfirmDialog
          label="Restart run"
          message={CONFIRM_MESSAGES.restart}
          confirmLabel="Restart"
          onCancel={() => setConfirmRestart(false)}
          onConfirm={() => {
            setConfirmRestart(false);
            void actions.restart(run.id);
          }}
        />
      )}
    </section>
  );
}
