import { describe, expect, it } from "vitest";
import {
  betweenLabel,
  resolvedPrompt,
  canOpenAgent,
  canStopRun,
  layoutForWidth,
  headerToggle,
  showBreakpointToggle,
  stateBanner,
  stepActions,
  stepMode,
  canStopAfter,
  stepPosition,
  stepModeLabel,
  type StepAction,
} from "./runControls";
import type { Run, RunState, StepRecord, StepStatus, WorkflowDef, WorkflowStepDef } from "./types";

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

describe("canOpenAgent", () => {
  const agent = { id: "a", slug: "a", kind: "agent", prompt: "p" } as WorkflowStepDef;
  const record = (status: StepRecord["status"], sessionId: string | null) => ({ stepId: "a", attempt: 1, status, output: "", sessionId }) as StepRecord;

  it("opens only a done agent step that has a session", () => {
    expect(canOpenAgent(agent, record("done", "s"))).toBe(true);
    expect(canOpenAgent(agent, record("needs_you", "s"))).toBe(false);
    expect(canOpenAgent(agent, record("running", "s"))).toBe(false);
    expect(canOpenAgent(agent, record("done", null))).toBe(false);
  });
});

describe("resolvedPrompt", () => {
  const wf = { id: "w", name: "W", steps: [
    { id: "a", slug: "a", kind: "agent", prompt: "write answer for 1 + {{i}}", input: { name: "i", label: "Number" } },
    { id: "b", slug: "b", kind: "agent", prompt: "use {{i}} and {{j}}", input: { name: "j", label: "Other" } },
  ] } as WorkflowDef;

  it("fills the step's own answer and leaves another step's placeholder alone", () => {
    const inputs = { i: "2", j: "7" };

    expect(resolvedPrompt(wf, wf.steps[0], { inputs })).toBe("write answer for 1 + 2");
    expect(resolvedPrompt(wf, wf.steps[1], { inputs })).toBe("use {{i}} and 7");
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
  const steps = (next: Partial<WorkflowStepDef>): WorkflowStepDef[] => [
    { ...agent, id: "s1", slug: "plan" },
    { ...agent, id: "s2", slug: "build", ...next },
  ];

  it("has no label before the first step", () => {
    expect(betweenLabel([agent], 0)).toBeNull();
  });

  it.each([
    [{}, "Passes previous output to step 2"],
    [{ agent: "handoff" as const }, "Passes previous output to step 2"],
    [{ agent: "new" as const }, "Fresh start · no context"],
    [{ kind: "review" as const }, "You review the diff from step 1"],
    [{ agent: "continue" as const }, "Resumes step 1's agent session"],
    [{ agent: "continue:s1" as const }, "Resumes step 1's agent session"],
  ])("labels %j", (next, expected) => {
    expect(betweenLabel(steps(next), 1)).toBe(expected);
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

describe("stepMode", () => {
  const agent = { id: "a", slug: "a", kind: "agent" as const, prompt: "p" };

  it.each([
    [{ ...agent }, "hand-off"],
    [{ ...agent, agent: "handoff" as const }, "hand-off"],
    [{ ...agent, agent: "new" as const }, "new"],
    [{ ...agent, agent: "continue" as const }, "continue"],
    [{ ...agent, kind: "review" as const }, "you"],
  ])("reads %j as %s", (def, expected) => {
    expect(stepMode(def, 1)).toBe(expected);
  });
});

describe("stepMode at index 0", () => {
  it("reads the first agent step as new whatever its stored mode", () => {
    expect(stepMode({ id: "a", slug: "a", kind: "agent", prompt: "p", agent: "handoff" }, 0)).toBe("new");
  });
});

describe("canStopAfter", () => {
  it.each([["running", true], ["paused", true], ["held", false], ["done", false]] as const)("%s -> %s", (state, expected) => {
    expect(canStopAfter(state)).toBe(expected);
  });
});

describe("stepPosition", () => {
  it("counts the current step one-based and falls back to the last step", () => {
    const steps = [step("a", "done"), step("b", "running"), step("c", "pending")];

    expect(stepPosition(run("running", { steps, currentStepId: "b" }))).toEqual({ index: 2, total: 3 });
    expect(stepPosition(run("done", { steps, currentStepId: null }))).toEqual({ index: 3, total: 3 });
  });

  it("points at the first unfinished step for a live run without a current step", () => {
    const steps = [step("a", "done"), step("b", "pending"), step("c", "pending")];

    expect(stepPosition(run("held", { steps, currentStepId: null }))).toEqual({ index: 2, total: 3 });
  });
});

describe("stepModeLabel", () => {
  const steps = [
    { id: "a", slug: "a", kind: "agent", prompt: "x", model: "opus" },
    { id: "b", slug: "b", kind: "agent", prompt: "y" },
  ] as WorkflowStepDef[];

  it("names the step's model, else the model its session ran on", () => {
    expect(stepModeLabel(steps, 0)).toBe("Agent · default · opus · new");
    expect(stepModeLabel(steps, 1, undefined, "claude-sonnet-5-5")).toBe("Agent · default · claude-sonnet-5-5 · new + hand-off");
    expect(stepModeLabel(steps, 1)).toBe("Agent · default · new + hand-off");
  });
});
