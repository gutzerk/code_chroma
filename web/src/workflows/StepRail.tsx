import { useState } from "react";
import { useOptionalAgentClient } from "../agents/AgentClientContext";
import { openStepAgent } from "../agents/launchAgent";
import type { Run, StepRecord, WorkflowDef } from "./types";
import { Icon } from "./icons";
import {
  ACTION_LABEL,
  betweenLabel,
  canOpenAgent,
  resumesChip,
  sessionBadge,
  STATUS_META,
  showBreakpointToggle,
  stepActions,
  stepModeLabel,
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
    case "skip":
      return void actions.skip(run.id, step.stepId);
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
  showOutput,
  onOpenAgent,
}: {
  run: Run;
  step: StepRecord;
  def: WorkflowDef["steps"][number] | undefined;
  slug: string;
  panelId: string;
  actions: WorkflowActions;
  rowActions: StepAction[];
  showOutput: boolean;
  /** Set on a finished agent step with a session: opens it forked in the Agents tab. */
  onOpenAgent?: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div id={panelId} className="step-controls" role="group" aria-label={`${slug} controls`}>
      {def?.skill && <p className="step-skill">{`Skill: ${def.skill}`}</p>}
      {def && def.prompt && <p className="step-prompt">{def.prompt}</p>}
      {showOutput && (
        <pre className="step-output" role="log" aria-label="Step output" data-testid="step-output">
          {step.output || "No output yet."}
        </pre>
      )}
      {rowActions.length === 0 && !onOpenAgent && <p className="step-none">No actions right now.</p>}
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
      {onOpenAgent && (
        <button
          type="button"
          className="step-action"
          data-testid={`open-agent-${slug}`}
          aria-label={`Open agent: ${slug}`}
          title="Opens this step's agent session (forked) in the Agents tab, in the run worktree"
          onClick={onOpenAgent}
        >
          <Icon name="agent" />
          Open agent
        </button>
      )}
    </div>
  );
}

/** First non-empty line of a step's output, the one-line summary a finished card shows. */
function summaryLine(output: string): string {
  return output.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("---")) ?? "";
}

/** What the nearest earlier finished agent step produced, for the review step that follows it. */
function previousResult(run: Run, workflow: WorkflowDef, index: number): { slug: string; text: string } | null {
  for (let i = index - 1; i >= 0; i--) {
    const record = run.steps[i];
    const def = workflow.steps.find((s) => s.id === record.stepId);
    if (record.status === "skipped" || def?.kind !== "agent") continue;
    const text = record.result?.trim() || (record.status === "done" ? summaryLine(record.output) : "");
    return text ? { slug: def.slug, text } : null;
  }
  return null;
}

/** The last few output lines of the running step, shown inline on its card. */
function liveLines(output: string): string[] {
  return output.split("\n").filter((l) => l.trim()).slice(-3);
}

/** The run steps as a numbered vertical timeline: status nodes joined by a rail, a card per step, context pills between steps, a breakpoint toggle on unstarted steps, one expanded card. */
export function StepRail({
  run,
  workflow,
  actions,
  expandedStepId,
  onToggle,
  readOnly = false,
  rerunFrom = null,
  showOutput = true,
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
  /** The expanded card carries the step output (off when a live view already shows it). */
  showOutput?: boolean;
}) {
  const agentClient = useOptionalAgentClient();
  const rerunIndex = rerunFrom === null ? -1 : workflow.steps.findIndex((s) => s.id === rerunFrom);
  return (
    <ol className="step-rail step-timeline" aria-label="Workflow steps" data-testid="step-rail">
      {run.steps.map((step, index) => {
        const defIndex = workflow.steps.findIndex((s) => s.id === step.stepId);
        const willRerun = rerunIndex >= 0 && defIndex >= rerunIndex;
        const def = workflow.steps[defIndex];
        const slug = def?.slug ?? step.stepId;
        const previous = run.steps[index - 1];
        const previousSlug = workflow.steps.find((s) => s.id === previous?.stepId)?.slug;
        const expanded = expandedStepId === step.stepId;
        const current = !readOnly && run.currentStepId === step.stepId;
        const hasBreakpoint = run.breakpoints.includes(step.stepId);
        const rowActions = readOnly ? [] : stepActions(run, step);
        const panelId = `step-panel-${run.id}-${step.stepId}`;
        const between = defIndex >= 0 ? betweenLabel(workflow.steps, defIndex, previousSlug) : null;
        const modeLabel = defIndex >= 0 ? stepModeLabel(workflow.steps, defIndex, undefined, step.usage?.model) : null;
        const badge = defIndex >= 0 ? sessionBadge(workflow.steps, defIndex, step) : null;
        const chip = defIndex >= 0 ? resumesChip(workflow.steps, defIndex, step) : null;
        const sessionId = step.sessionId;
        const onOpenAgent =
          agentClient && sessionId && canOpenAgent(def, step)
            ? () => void openStepAgent(agentClient, `${slug} ${run.id}`, run.id, sessionId)
            : undefined;
        const yours = def?.kind === "review";
        const summary = step.status === "done" ? summaryLine(step.result?.trim() || step.output) : "";
        const handedOver = yours && (step.status === "needs_you" || expanded) ? previousResult(run, workflow, index) : null;
        const live = step.status === "running" ? liveLines(step.output) : [];
        return (
          <li
            key={step.stepId}
            className="step-row"
            data-testid={`step-row-${slug}`}
            data-status={step.status}
            data-kind={def?.kind}
            data-current={current || undefined}
            data-will-rerun={willRerun || undefined}
          >
            {between && (
              <div className="step-between-row" data-after={previous?.status}>
                <span className="step-between-rail" aria-hidden="true" />
                <p className="step-between" data-testid={`between-${slug}`} title={between}>
                  {between}
                </p>
              </div>
            )}
            <div className="step-node-row">
              <div className="step-node-col">
                <span
                  className="step-number"
                  role="img"
                  aria-label={yours && step.status === "pending" ? "Pending, your step" : STATUS_META[step.status].text}
                >
                  {index + 1}
                </span>
                {index < run.steps.length - 1 && <span className="step-rail-line" aria-hidden="true" />}
              </div>
              <div className="step-card">
                <button
                  type="button"
                  className="step-head"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${slug}, ${STATUS_META[step.status].text}`}
                  onClick={() => onToggle(step.stepId)}
                >
                  <span className="step-title-line">
                    <span className="step-slug">{slug}</span>
                    {step.fromAttempt !== undefined && (
                      <span className="step-tag step-tag-kept" data-testid={`kept-${slug}`}>
                        {`from attempt ${step.fromAttempt}`}
                      </span>
                    )}
                    {willRerun && (
                      <span className="step-tag step-tag-rerun" data-testid={`will-rerun-${slug}`}>
                        <Icon name="redo" />
                        {"Will rerun"}
                      </span>
                    )}
                    {willRerun && def?.kind === "agent" && (
                      <span className="step-tag step-tag-redraw" data-testid={`will-redraw-${slug}`}>
                        will redraw
                      </span>
                    )}
                    <span className="step-status">{STATUS_META[step.status].text}</span>
                  </span>
                  {def && (
                    <span className="step-sub" data-yours={yours || undefined}>
                      {yours ? (step.status === "pending" || step.status === "needs_you" ? "Your step · approve or send back" : "Your step") : <span data-testid={`mode-${slug}`}>{modeLabel}</span>}
                    </span>
                  )}
                  {(badge || chip) && (
                    <span className="step-meta" data-testid={`step-meta-${slug}`}>
                      {badge && (
                        <span
                          className="step-tag step-tag-session"
                          data-testid={`session-badge-${slug}`}
                          data-warn={badge.warn}
                          title={step.usage ? `${step.usage.contextTokens.toLocaleString()} context tokens` : undefined}
                        >
                          {badge.warn && <Icon name="alert" />}
                          {badge.text}
                        </span>
                      )}
                      {chip && (
                        <span className="step-tag step-tag-resumes" data-testid={`resumes-${slug}`}>
                          {chip}
                        </span>
                      )}
                    </span>
                  )}
                  {summary && <span className="step-summary">{summary}</span>}
                  {step.status === "needs_you" && step.report && step.report.status !== "done" && (
                    <span className="step-summary">
                      {`Agent ${step.report.status === "question" ? "asks" : "is blocked"}: ${step.report.note || "no details"}`}
                    </span>
                  )}
                  {step.diffStat && <span className="step-diff-summary">{step.diffStat}</span>}
                  {live.length > 0 && (
                    <span className="step-live">
                      {live.map((line, i) => (
                        <span key={i}>{line}</span>
                      ))}
                    </span>
                  )}
                </button>
                {!readOnly && showBreakpointToggle(step) && (
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
                )}
                {handedOver && (
                  <div className="step-handover" data-testid={`handover-${slug}`}>
                    <span className="step-handover-title">{`Result from ${handedOver.slug}`}</span>
                    <pre className="step-handover-text">{handedOver.text}</pre>
                  </div>
                )}
                {expanded && (
                  <StepControls
                    run={run}
                    step={step}
                    def={def}
                    slug={slug}
                    panelId={panelId}
                    actions={actions}
                    rowActions={rowActions}
                    showOutput={showOutput}
                    onOpenAgent={readOnly ? undefined : onOpenAgent}
                  />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
