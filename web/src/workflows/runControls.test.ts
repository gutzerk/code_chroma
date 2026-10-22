import { describe, expect, it } from "vitest";
import {
  betweenLabel,
  canStopRun,
  layoutForWidth,
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

  it("allows Cancel while the run is live, including held and awaiting review", () => {
    const stoppable = (["running", "paused", "held", "needs_you", "stopped", "done"] as RunState[]).filter(
      canStopRun,
    );

    expect(stoppable).toEqual(["running", "paused", "held", "needs_you"]);
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

describe("betweenLabel", () => {
  const agent = { id: "a", slug: "a", kind: "agent" as const, prompt: "p" };

  it("has no label before the first step", () => {
    expect(betweenLabel(agent, 0)).toBeNull();
  });

  it.each([
    [{ ...agent }, 2, "Passes output to step 2"],
    [{ ...agent, context: "fresh" as const }, 1, "Fresh start · no context"],
    [{ ...agent, kind: "review" as const }, 1, "You review the diff"],
  ])("labels %j at index %i", (def, index, expected) => {
    expect(betweenLabel(def, index)).toBe(expected);
  });
});

describe("layoutForWidth", () => {
  it.each([
    [0, "normal"],
    [320, "narrow"],
    [321, "normal"],
    [640, "side"],
    [1100, "full"],
  ])("maps %i px to %s", (width, expected) => {
    expect(layoutForWidth(width)).toBe(expected);
  });
});
