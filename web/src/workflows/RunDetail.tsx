import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./workflows.css";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
import { RedoCard } from "./RedoCard";
import { RunChat } from "./RunChat";
import { StepRail } from "./StepRail";
import { stepsForAttempt } from "./redoPlan";
import {
  CONFIRM_MESSAGES,
  canStopAfter,
  RUN_STATE_COLOR,
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

/** One transcript line, tinted the way the agent terminal reads: tool steps grey, passing checks green. */
function TranscriptLine({ text }: { text: string }) {
  const tone = /^[●⏺]/.test(text) ? "tool" : /^\s*✓/.test(text) ? "ok" : undefined;
  return (
    <div className="live-line" data-tone={tone}>
      {text || " "}
    </div>
  );
}

/** The shown step, live (full layout third column): header with the Agent / Output / Diff tabs, the body, then the chat footer. */
function LiveView({ run, workflow, step, footer }: { run: Run; workflow: WorkflowDef; step: StepRecord | undefined; footer: ReactNode }) {
  const [tab, setTab] = useState<LiveTab>("agent");
  const stepIndex = workflow.steps.findIndex((s) => s.id === step?.stepId);
  const def = workflow.steps[stepIndex];
  const messages = (run.messages ?? []).filter((m) => m.target === step?.stepId);
  const sub = [`workflow/${run.id}`, step?.diffStat].filter(Boolean).join(" · ");
  return (
    <div className="wf-live" data-testid="live-view">
      <div className="wf-live-head">
        <span className="wf-live-dot" aria-hidden="true" style={{ background: RUN_STATE_COLOR[run.state] }} />
        <span className="wf-live-title">
          <span>{def ? `Step ${stepIndex + 1} · ${def.slug}` : "No step selected"}</span>
          <small>{sub}</small>
        </span>
        <div className="wf-tabs" role="tablist" aria-label="Step view">
          {LIVE_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="wf-tab" aria-selected={tab === t.id} data-testid={`live-tab-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="wf-live-body" role="log" aria-label="Step output" data-testid="step-output">
        {!step || !def ? (
          <p>Select a step to see it live.</p>
        ) : tab === "agent" ? (
          <>
            {def.prompt && <div className="live-line" data-tone="prompt">{`> ${def.prompt.split("\n")[0]}`}</div>}
            {step.output.split("\n").map((line, i) => (
              <TranscriptLine key={i} text={line} />
            ))}
            {messages.map((m) => (
              <div key={m.id} className="live-line">{`${m.role}: ${m.text}`}</div>
            ))}
          </>
        ) : tab === "output" ? (
          <pre className="workflow-output-text">{step.output || "No output yet."}</pre>
        ) : (
          <p className="workflow-diffstat">{step.diffStat ?? "No changes yet."}</p>
        )}
      </div>
      {footer}
    </div>
  );
}

/** One run in full: header and controls, attempts, banner, step timeline, redo card and chat; the full layout adds the live step column. */
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
  const [confirm, setConfirm] = useState<"restart" | "delete" | null>(null);
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
  const finished = isFinished(run.state);
  const full = layout === "full";
  const narrow = layout === "narrow";
  const stopAfterToggle = () =>
    void (run.stopAfter ? actions.keepRunning(run.id) : actions.stop(run.id, "afterStep"));
  const editWorkflow = () => workflowStore.setDialog({ kind: "editor", workflow });

  const secondary: MenuItem[] = [
    { label: run.stopAfter ? "Keep running" : "Stop after step", icon: "stop", disabled: !canStopAfter(run.state), onSelect: stopAfterToggle },
    { label: "Restart", icon: "restart", disabled: !finished, onSelect: () => setConfirm("restart") },
    { label: "Edit workflow", icon: "edit", onSelect: editWorkflow },
    finished
      ? { label: "Delete run", icon: "trash", danger: true, onSelect: () => setConfirm("delete") }
      : { label: "Cancel run", icon: "cancel", danger: true, disabled: !canStopRun(run.state), onSelect: () => void actions.stop(run.id, "now") },
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
      showOutput={!full}
    />
  );

  const chat = <RunChat run={run} workflow={workflow} actions={actions} />;

  return (
    <section className="workflow-screen" aria-label="Workflow run" data-testid="workflow-screen" data-layout={layout}>
      <div className="wf-run-col">
        <header className="workflow-header">
          <div className="workflow-heading">
            {onBack && (
              <button type="button" className="wf-back" aria-label="All workflow runs" data-testid="run-back" onClick={onBack}>
                <Icon name="back" size={16} />
              </button>
            )}
            <div className="workflow-heading-text">
              <h2 className="workflow-title wf-truncate" title={workflow.name}>
                {workflow.name}
              </h2>
              <p className="workflow-sub wf-truncate">{`Run ${run.id} · workflow/${run.id}`}</p>
            </div>
            <span className="workflow-state" data-testid="run-state" data-state={run.state}>
              {RUN_STATE_TEXT[run.state]}
            </span>
          </div>
          <div className="workflow-header-actions">
            <button
              type="button"
              className="wf-btn"
              data-testid="header-toggle"
              disabled={!toggle.enabled}
              onClick={() => void (running ? actions.pause(run.id) : actions.resume(run.id))}
            >
              {toggle.label}
            </button>
            {narrow ? (
              <>
                <span className="wf-spacer" />
                <OverflowMenu items={secondary} />
              </>
            ) : (
              <>
                <button type="button" className="wf-btn" data-testid="stop-after" disabled={!canStopAfter(run.state)} onClick={stopAfterToggle}>
                  {run.stopAfter ? "Keep running" : "Stop after step"}
                </button>
                <button type="button" className="wf-btn" data-testid="restart-run" disabled={!finished} onClick={() => setConfirm("restart")}>
                  Restart
                </button>
                <button type="button" className="wf-btn" data-testid="edit-workflow" onClick={editWorkflow}>
                  Edit workflow
                </button>
                <span className="wf-spacer" />
                {finished ? (
                  <button type="button" className="wf-btn wf-btn-danger" data-testid="delete-run" onClick={() => setConfirm("delete")}>
                    Delete run
                  </button>
                ) : (
                  <button type="button" className="wf-btn wf-btn-danger" data-testid="cancel-run" disabled={!canStopRun(run.state)} onClick={() => void actions.stop(run.id, "now")}>
                    Cancel run
                  </button>
                )}
              </>
            )}
          </div>
        </header>
        <div className="wf-timeline-col">
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
          {timeline}
          {proposal && redoFrom && (
            <RedoCard run={run} workflow={workflow} proposal={proposal} actions={actions} from={redoFrom} onFromChange={setPickedFrom} />
          )}
        </div>
        {!full && chat}
      </div>
      {full && <LiveView run={run} workflow={workflow} step={shownStep} footer={chat} />}
      {confirm === "restart" && (
        <ConfirmDialog
          label="Restart run"
          message={CONFIRM_MESSAGES.restart}
          confirmLabel="Restart"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void actions.restart(run.id);
          }}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          label="Delete run"
          message={CONFIRM_MESSAGES.deleteRun(run.id)}
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void actions.deleteRun(run.id);
          }}
        />
      )}
    </section>
  );
}
