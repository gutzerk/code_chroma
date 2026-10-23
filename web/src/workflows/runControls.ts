import type { IconName } from "./icons";
import { agentMode, continueSourceIndex, continueTargetIndex, type Run, type RunState, type StepRecord, type StepStatus, type WorkflowStepDef } from "./types";

/** One action a step row or the run header can offer. */
export type StepAction =
  | "stopAfter"
  | "keepRunning"
  | "resume"
  | "continue"
  | "resumeFrom"
  | "approve"
  | "sendBack"
  | "skip";

/** Per-status text and glyph (icon name + text, so a status is never conveyed by colour alone). */
export const STATUS_META: Record<StepStatus, { text: string; icon: IconName }> = {
  pending: { text: "Pending", icon: "circle" },
  running: { text: "Running", icon: "play" },
  paused: { text: "Paused", icon: "pause" },
  stopping: { text: "Stopping", icon: "stopping" },
  held: { text: "Held", icon: "hold" },
  stopped: { text: "Stopped", icon: "stop" },
  needs_you: { text: "Needs you", icon: "alert" },
  done: { text: "Done", icon: "check" },
  skipped: { text: "Skipped", icon: "skip" },
};

/** Icon and accent per step kind, so an agent step and a review step read differently at a glance. */
export const KIND_META: Record<"agent" | "review", { text: string; icon: IconName; color: string }> = {
  agent: { text: "Agent", icon: "agent", color: "#8fb0ff" },
  review: { text: "Your review", icon: "review", color: "#facc15" },
};

/** Accent colour per run state for the run list and header. */
export const RUN_STATE_COLOR: Record<RunState, string> = {
  running: "#8fb0ff",
  paused: "#facc15",
  stopping: "#facc15",
  held: "#facc15",
  stopped: "#f87171",
  needs_you: "#facc15",
  done: "#4ade80",
};

export const RUN_STATE_TEXT: Record<RunState, string> = {
  running: "Running",
  paused: "Paused",
  stopping: "Stopping",
  held: "Held",
  stopped: "Stopped",
  needs_you: "Needs you",
  done: "Done",
};

export const ACTION_LABEL: Record<StepAction, string> = {
  stopAfter: "Stop after this step",
  keepRunning: "Keep running",
  resume: "Resume",
  continue: "Continue",
  resumeFrom: "Resume from here",
  approve: "Approve",
  sendBack: "Send back",
  skip: "Skip this step",
};

/** The 22px breakpoint gutter is interactive on unstarted steps only. */
export function showBreakpointToggle(step: StepRecord): boolean {
  return step.status === "pending";
}

/** Actions offered on one step row, per its status and the run around it. */
export function stepActions(run: Run, step: StepRecord): StepAction[] {
  switch (step.status) {
    case "pending":
      return run.state === "stopped" || run.state === "held" ? ["resumeFrom", "skip"] : ["skip"];
    case "running":
      return [run.stopAfter === step.stepId ? "keepRunning" : "stopAfter"];
    case "paused":
      return ["resume"];
    case "held":
      return ["continue", "skip"];
    case "stopped":
      return ["resumeFrom", "skip"];
    case "needs_you":
      return ["approve", "sendBack", "skip"];
    case "stopping":
    case "done":
    case "skipped":
      return [];
  }
}

export type HeaderToggle = { label: "Pause" | "Resume" | "Continue"; enabled: boolean };

/** The header's Pause / Resume / Continue control for the run's state. */
export function headerToggle(state: RunState): HeaderToggle {
  if (state === "paused") return { label: "Resume", enabled: true };
  if (state === "held") return { label: "Continue", enabled: true };
  return { label: "Pause", enabled: state === "running" };
}

/** Cancel is legal in every live state (the bridge's StopNow row), including held and awaiting review. */
export function canStopRun(state: RunState): boolean {
  return state === "running" || state === "paused" || state === "held" || state === "needs_you";
}

/** The banner sentence for a non-running state, or null when nothing needs saying. */
export function stateBanner(run: Run, stepLabel: (stepId: string | null) => string): string | null {
  const current = stepLabel(run.currentStepId);
  switch (run.state) {
    case "paused":
      return `Paused at ${current}. The agent holds after its current tool call.`;
    case "held":
      return `Held before ${current}. Continue to run it.`;
    case "stopping":
      return `Stopping ${current}...`;
    case "stopped":
      return `Stopped at ${current}. Partial changes are kept uncommitted.`;
    case "needs_you":
      return `${current} is waiting for your review.`;
    case "done":
      return "Run complete.";
    case "running":
      return run.stopAfter ? `Will hold after ${stepLabel(run.stopAfter)}.` : null;
  }
}

/** The label between step `index - 1` and `index` (index 0 has none): how context flows into that step. */
export function betweenLabel(steps: WorkflowStepDef[], index: number, previousSlug = "previous"): string | null {
  const def = steps[index];
  if (!def || index <= 0) return null;
  if (def.kind === "review") return `You review the diff from step ${index}`;
  const mode = agentMode(def.agent);
  if (mode === "new") return "Fresh start · no context";
  if (mode === "continue") {
    const source = continueSourceIndex(steps, index);
    return source < 0 ? "Resumes an earlier agent session" : `Resumes step ${source + 1}'s agent session`;
  }
  return `Passes ${previousSlug} output to step ${index + 1}`;
}

/** How a step gets its context, in the words the workflow lists and run timeline both use. */
export function stepMode(def: WorkflowStepDef): "you" | "new" | "hand-off" | "continue" {
  if (def.kind === "review") return "you";
  const mode = agentMode(def.agent);
  return mode === "handoff" ? "hand-off" : mode;
}

/** "step 2 of 4" for the step a run is on (the last one once the run is over). */
export function stepPosition(run: Run): { index: number; total: number } {
  const current = run.steps.findIndex((s) => s.stepId === run.currentStepId);
  return { index: current >= 0 ? current + 1 : run.steps.length, total: run.steps.length };
}

/** Fallback before the bridge has judged a step: amber past this many steps in one session. */
export const CHAIN_WARN_STEPS = 3;

const MODE_TEXT: Record<"new" | "handoff", string> = { new: "new", handoff: "new + hand-off" };

/** "Agent · <provider or default> · new | new + hand-off | continue: <source slug>"; null for a review step; step 1 is always new. */
export function stepModeLabel(
  steps: WorkflowStepDef[],
  index: number,
  providerLabel: (id: string) => string = (id) => id,
): string | null {
  const def = steps[index];
  if (!def || def.kind !== "agent") return null;
  const provider = def.provider ? providerLabel(def.provider) : "default";
  const mode = index === 0 ? "new" : agentMode(def.agent);
  const text = mode === "continue" ? `continue: ${steps[continueTargetIndex(steps, index)]?.slug || "?"}` : MODE_TEXT[mode];
  return `Agent · ${provider} · ${text}`;
}

/** How many steps a continue chain ending at `index` spans (1 for a step that does not continue), like the bridge's StepAgents.ChainLength. */
export function chainLength(steps: WorkflowStepDef[], index: number): number {
  let length = 1;
  for (let i = continueSourceIndex(steps, index); i >= 0; i = continueSourceIndex(steps, i)) length++;
  return length;
}

export interface SessionBadge {
  warn: boolean;
  text: string;
}

/** The "Continuing an N-step session" badge of a continue step, or null; the bridge's chain length and warning win over the definition walk. */
export function sessionBadge(steps: WorkflowStepDef[], index: number, record?: StepRecord): SessionBadge | null {
  if (continueSourceIndex(steps, index) < 0) return null;
  const n = record?.chainLength ?? chainLength(steps, index);
  const warn = record?.chainWarning ?? n > CHAIN_WARN_STEPS;
  return { warn, text: `Continuing ${n === 8 || n === 11 || n === 18 ? "an" : "a"} ${n}-step session` };
}

/** The teal chip of a step that resumed an earlier step's session: from the record when it ran, else from the definition. */
export function resumesChip(steps: WorkflowStepDef[], index: number, record?: StepRecord): string | null {
  const fromRecord = record?.resumedFrom ? steps.findIndex((s) => s.id === record.resumedFrom) : -1;
  const source = fromRecord >= 0 ? fromRecord : continueSourceIndex(steps, index);
  return source < 0 ? null : `Resumes step ${source + 1}'s agent session`;
}

/** "Open agent" needs a finished agent step with a recorded session. */
export function canOpenAgent(def: WorkflowStepDef | undefined, step: StepRecord): boolean {
  return def?.kind === "agent" && step.status === "done" && !!step.sessionId;
}

/** Run states that are over (restartable and deletable) versus live. */
export function isFinished(state: RunState): boolean {
  return state === "done" || state === "stopped";
}

/** Shared confirm wording so the list and the detail header say the same thing. */
export const CONFIRM_MESSAGES = {
  restart: "Restarting wipes the previous result (worktree, outputs, messages and attempts) and starts again from step 1.",
};

/** Steps done or skipped, for a progress readout. */
export function finishedCount(run: Run): number {
  return run.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
}

export type PanelLayout = "narrow" | "normal" | "side" | "full";

/** Layout class for a container width; 0 (unmeasured) reads as normal. */
export function layoutForWidth(width: number): PanelLayout {
  if (width <= 0) return "normal";
  if (width <= 320) return "narrow";
  if (width >= 1100) return "full";
  if (width >= 640) return "side";
  return "normal";
}
