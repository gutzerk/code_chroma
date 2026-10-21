import { describe, expect, it } from "vitest";
import {
  canStopRun,
  headerToggle,
  showBreakpointToggle,
  stateBanner,
  stepActions,
  type StepAction,
} from "./runControls";
import type { Run, RunState, StepRecord, StepStatus } from "./types";

function step(stepId: string, status: StepStatus): StepRecord {
  return { stepId, attempt: 1, status, output: "", diffStat: null, checkpointRef: null, sessionId: null };
}

function run(state: RunState, overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    workflowId: "w",
    state,
    currentStepId: "s1",
    stopAfter: null,
    attempt: 1,
    attempts: [{ n: 1, branch: null }],
    breakpoints: [],
    steps: [],
    ...overrides,
  };
}

describe("stepActions status matrix", () => {
  const cases: [StepStatus, RunState, StepAction[]][] = [
    ["pending", "running", ["skip"]],
    ["pending", "held", ["resumeFrom", "skip"]],
    ["pending", "stopped", ["resumeFrom", "skip"]],
    ["running", "running", ["stopAfter"]],
    ["paused", "paused", ["resume"]],
    ["stopping", "stopping", []],
    ["held", "held", ["continue", "skip"]],
    ["stopped", "stopped", ["resumeFrom", "skip"]],
    ["needs_you", "needs_you", ["approve", "sendBack", "skip"]],
    ["done", "running", []],
  ];

  it.each(cases)("%s step in a %s run offers %j", (status, state, expected) => {
    const actions = stepActions(run(state), step("s1", status));

    expect(actions).toEqual(expected);
  });

  it("offers keepRunning instead of stopAfter once stop-after is set on that step", () => {
    const actions = stepActions(run("running", { stopAfter: "s1" }), step("s1", "running"));

    expect(actions).toEqual(["keepRunning"]);
  });
});

describe("breakpoint gutter", () => {
  it.each<[StepStatus, boolean]>([
    ["pending", true],
    ["running", false],
    ["paused", false],
    ["held", false],
    ["stopped", false],
    ["needs_you", false],
    ["done", false],
    ["stopping", false],
  ])("%s -> interactive %s", (status, expected) => {
    expect(showBreakpointToggle(step("s1", status))).toBe(expected);
  });
});

describe("header controls", () => {
  it.each<[RunState, string, boolean]>([
    ["running", "Pause", true],
    ["paused", "Resume", true],
    ["held", "Continue", true],
    ["stopped", "Pause", false],
    ["stopping", "Pause", false],
    ["needs_you", "Pause", false],
    ["done", "Pause", false],
  ])("%s -> %s (enabled %s)", (state, label, enabled) => {
    expect(headerToggle(state)).toEqual({ label, enabled });
  });

  it("allows Stop run only while running", () => {
    const stoppable = (["running", "paused", "held", "stopped", "done"] as RunState[]).filter(
      canStopRun,
    );

    expect(stoppable).toEqual(["running"]);
  });
});

describe("stateBanner", () => {
  const label = (id: string | null) => id ?? "the run";

  it("is silent while running with nothing scheduled", () => {
    expect(stateBanner(run("running"), label)).toBeNull();
  });

  it("announces a pending stop-after while running", () => {
    expect(stateBanner(run("running", { stopAfter: "s2" }), label)).toContain("s2");
  });

  it.each<RunState>(["paused", "held", "stopping", "stopped", "needs_you", "done"])(
    "says something for %s",
    (state) => {
      expect(stateBanner(run(state), label)).toBeTruthy();
    },
  );
});
