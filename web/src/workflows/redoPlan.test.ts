import { describe, expect, it } from "vitest";
import { MOCK_WORKFLOW } from "./mockWorkflows";
import { computeRedoCard, isLaterThanSuggested, stepsForAttempt } from "./redoPlan";
import type { Run, StepRecord, StepStatus } from "./types";

function rec(stepId: string, status: StepStatus, attempt = 1): StepRecord {
  return { stepId, attempt, status, output: "", diffStat: null, checkpointRef: null, sessionId: null };
}

function runWith(statuses: StepStatus[]): Run {
  return {
    id: "r",
    workflowId: MOCK_WORKFLOW.id,
    state: "stopped",
    currentStepId: null,
    stopAfter: null,
    attempt: 1,
    attempts: [{ n: 1, branch: null }],
    breakpoints: [],
    steps: MOCK_WORKFLOW.steps.map((s, i) => rec(s.id, statuses[i])),
  };
}

describe("computeRedoCard", () => {
  it.each([
    ["s1", ["s1", "s2", "s3", "s4"], [], ["s1", "s2"]],
    ["s2", ["s2", "s3", "s4"], ["s1"], ["s2"]],
    ["s3", ["s3", "s4"], ["s1", "s2"], []],
    ["s4", ["s4"], ["s1", "s2", "s3"], []],
  ])("from %s reruns, keeps and sets aside", (from, reruns, keeps, setsAside) => {
    const run = runWith(["done", "done", "pending", "pending"]);

    const card = computeRedoCard(MOCK_WORKFLOW, run, from);

    expect(card.reruns).toEqual(reruns);
    expect(card.keeps).toEqual(keeps);
    expect(card.setsAside).toEqual(setsAside);
  });

  it("warns only when the pick is later than suggested", () => {
    expect(isLaterThanSuggested(MOCK_WORKFLOW, "s2", "s3")).toBe(true);
    expect(isLaterThanSuggested(MOCK_WORKFLOW, "s2", "s2")).toBe(false);
    expect(isLaterThanSuggested(MOCK_WORKFLOW, "s2", "s1")).toBe(false);
  });
});

describe("stepsForAttempt", () => {
  it("returns the records of the requested attempt in workflow order", () => {
    const run = runWith(["done", "done", "done", "done"]);
    run.attempt = 2;
    run.attempts = [{ n: 1, branch: "r/attempt-1", steps: run.steps }, { n: 2, branch: null }];
    run.steps = [
      { ...rec("s1", "done", 2), fromAttempt: 1 },
      rec("s2", "running", 2),
      rec("s3", "pending", 2),
      rec("s4", "pending", 2),
    ];

    expect(stepsForAttempt(run, MOCK_WORKFLOW, 1)).toHaveLength(4);
    expect(stepsForAttempt(run, MOCK_WORKFLOW, 2).map((s) => s.stepId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(stepsForAttempt(run, MOCK_WORKFLOW, 2)[0].fromAttempt).toBe(1);
  });
});
