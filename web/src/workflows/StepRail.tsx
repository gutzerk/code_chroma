import { useState } from "react";
import { useOptionalAgentClient } from "../agents/AgentClientContext";
import { openStepAgent } from "../agents/launchAgent";
import type { Run, StepRecord, WorkflowDef } from "./types";
import { Icon } from "./icons";
import {
  ACTION_LABEL,
  betweenLabel,
  canOpenAgent,
  KIND_META,
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
  onOpenAgent,
}: {
  run: Run;
  step: StepRecord;
  def: WorkflowDef["steps"][number] | undefined;
  slug: string;
  panelId: string;
  actions: WorkflowActions;
  rowActions: StepAction[];
  /** Set on a finished agent step with a session: opens it forked in the Agents tab. */
  onOpenAgent?: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div id={panelId} className="step-controls" role="group" aria-label={`${slug} controls`}>
      {def?.skill && <p className="step-skill">{`Skill: ${def.skill}`}</p>}
      {def && def.prompt && <p className="step-prompt">{def.prompt}</p>}
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

/** The run steps as a numbered vertical timeline: context labels between steps, status as icon + text, a breakpoint gutter on unstarted steps, one expanded row. */
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
  const agentClient = useOptionalAgentClient();
  const rerunIndex = rerunFrom === null ? -1 : workflow.steps.findIndex((s) => s.id === rerunFrom);
  return (
    <ol className="step-rail step-timeline" aria-label="Workflow steps" data-testid="step-rail">
      {run.steps.map((step, index) => {
        const defIndex = workflow.steps.findIndex((s) => s.id === step.stepId);
        const willRerun = rerunIndex >= 0 && defIndex >= rerunIndex;
        const def = workflow.steps[defIndex];
        const slug = def?.slug ?? step.stepId;
        const expanded = expandedStepId === step.stepId;
        const hasBreakpoint = run.breakpoints.includes(step.stepId);
        const rowActions = readOnly ? [] : stepActions(run, step);
        const panelId = `step-panel-${run.id}-${step.stepId}`;
        const between = defIndex >= 0 ? betweenLabel(workflow.steps, defIndex) : null;
        const modeLabel = defIndex >= 0 ? stepModeLabel(workflow.steps, defIndex) : null;
        const badge = defIndex >= 0 ? sessionBadge(workflow.steps, defIndex, step) : null;
        const chip = defIndex >= 0 ? resumesChip(workflow.steps, defIndex, step) : null;
        const sessionId = step.sessionId;
        const onOpenAgent =
          agentClient && sessionId && canOpenAgent(def, step)
            ? () => void openStepAgent(agentClient, `${slug} ${run.id}`, run.id, sessionId)
            : undefined;
        return (
          <li
            key={step.stepId}
            className="step-row"
            data-testid={`step-row-${slug}`}
            data-status={step.status}
            data-current={(!readOnly && run.currentStepId === step.stepId) || undefined}
            data-will-rerun={willRerun || undefined}
          >
            {between && (
              <p className="step-between" data-testid={`between-${slug}`} title={between}>
                {between}
              </p>
            )}
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
                <span className="step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="step-icon" aria-hidden="true">
                  <Icon name={STATUS_META[step.status].icon} />
                </span>
                {def && (
                  <span
                    className="step-kind"
                    data-kind={def.kind}
                    style={{ color: KIND_META[def.kind].color }}
                    title={KIND_META[def.kind].text}
                  >
                    <Icon name={KIND_META[def.kind].icon} />
                    <span className="visually-hidden">{KIND_META[def.kind].text}</span>
                  </span>
                )}
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
                    <Icon name="redo" />
                    {"Will rerun"}
                  </span>
                )}
                {willRerun && def?.kind === "agent" && (
                  <span className="step-tag step-tag-redraw" data-testid={`will-redraw-${slug}`}>
                    will redraw
                  </span>
                )}
              </button>
            </div>
            {(modeLabel || badge || chip) && (
              <p className="step-meta" data-testid={`step-meta-${slug}`}>
                {modeLabel && <span data-testid={`mode-${slug}`}>{modeLabel}</span>}
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
              </p>
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
                onOpenAgent={readOnly ? undefined : onOpenAgent}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
