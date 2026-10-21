import type { Run, RunState, StepRecord, StepStatus } from "./types";

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
  skipped: { text: "Skipped", icon: "⤼" },
};

/** Icon and accent per step kind, so an agent step and a review step read differently at a glance. */
export const KIND_META: Record<"agent" | "review", { text: string; icon: string; color: string }> = {
  agent: { text: "Agent", icon: "✦", color: "#8fb0ff" },
  review: { text: "Your review", icon: "☑", color: "#facc15" },
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
