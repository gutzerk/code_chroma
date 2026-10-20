import type { Run, RunState, StepRecord, StepStatus } from "./types";

/** One action a step row or the run header can offer. */
export type StepAction =
  | "stopAfter"
  | "keepRunning"
  | "resume"
  | "continue"
  | "resumeFrom"
  | "approve"
  | "sendBack";

/** Per-status text and glyph (icon + text, so a status is never conveyed by colour alone). */
export const STATUS_META: Record<StepStatus, { text: string; icon: string }> = {
  pending: { text: "Pending", icon: "○" },
  running: { text: "Running", icon: "▶" },
  paused: { text: "Paused", icon: "❚❚" },
  stopping: { text: "Stopping", icon: "◌" },
  held: { text: "Held", icon: "⏸" },
  stopped: { text: "Stopped", icon: "■" },
  needs_you: { text: "Needs you", icon: "?" },
  done: { text: "Done", icon: "✓" },
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
};

/** The 22px breakpoint gutter is interactive on unstarted steps only. */
export function showBreakpointToggle(step: StepRecord): boolean {
  return step.status === "pending";
}

/** Actions offered on one step row, per its status and the run around it. */
export function stepActions(run: Run, step: StepRecord): StepAction[] {
  switch (step.status) {
    case "pending":
      return run.state === "stopped" || run.state === "held" ? ["resumeFrom"] : [];
    case "running":
      return [run.stopAfter === step.stepId ? "keepRunning" : "stopAfter"];
    case "paused":
      return ["resume"];
    case "held":
      return ["continue"];
    case "stopped":
      return ["resumeFrom"];
    case "needs_you":
      return ["approve", "sendBack"];
    case "stopping":
    case "done":
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

/** Stop run is only legal while the run is actually running (the contract's transition table). */
export function canStopRun(state: RunState): boolean {
  return state === "running";
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
