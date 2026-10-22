import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StepRail } from "./StepRail";
import type { Run, StepRecord, StepStatus, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

const workflow: WorkflowDef = {
  id: "w",
  name: "Ship",
  steps: [
    { id: "s1", slug: "plan", kind: "agent", prompt: "Plan it", skill: "planner" },
    { id: "s2", slug: "implement", kind: "agent", prompt: "Build it" },
    { id: "s3", slug: "review", kind: "review", prompt: "Look it over" },
  ],
};

function step(stepId: string, status: StepStatus, extra: Partial<StepRecord> = {}): StepRecord {
  return {
    stepId, attempt: 1, status, output: "", diffStat: null, checkpointRef: null, sessionId: null,
    ...extra,
  };
}

function makeRun(steps: StepRecord[], overrides: Partial<Run> = {}): Run {
  return {
    id: "r1", workflowId: "w", state: "running", currentStepId: "s2", stopAfter: null,
    attempt: 1, attempts: [{ n: 1, branch: null }], breakpoints: [], steps, ...overrides,
  };
}

function fakeActions() {
  return {
    stop: vi.fn(), keepRunning: vi.fn(), resume: vi.fn(), resumeFrom: vi.fn(),
    review: vi.fn(), skip: vi.fn(), setBreakpoint: vi.fn(),
  };
}

function renderRail(run: Run, props: Partial<Parameters<typeof StepRail>[0]> = {}) {
  const actions = fakeActions();
  render(
    <StepRail
      run={run}
      workflow={workflow}
      actions={actions as unknown as WorkflowActions}
      expandedStepId={null}
      onToggle={() => {}}
      {...props}
    />,
  );
  return actions;
}

const threeSteps = () => [step("s1", "done"), step("s2", "running"), step("s3", "pending")];

describe("StepRail", () => {
  afterEach(cleanup);

  it("renders one row per step with its slug, status text and current marker", () => {
    renderRail(makeRun(threeSteps()));

    expect(screen.getAllByTestId(/^step-row-/)).toHaveLength(3);
    expect(screen.getByTestId("step-row-implement")).toHaveAttribute("data-current", "true");
    expect(screen.getByTestId("step-row-plan")).not.toHaveAttribute("data-current");
    expect(screen.getByLabelText("implement, Running")).toBeInTheDocument();
  });

  it("falls back to the step id when the workflow has no matching step", () => {
    renderRail(makeRun([step("ghost", "pending")]));

    expect(screen.getByTestId("step-row-ghost")).toBeInTheDocument();
  });

  it("offers a breakpoint toggle only on pending steps and reports it pressed", () => {
    renderRail(makeRun(threeSteps(), { breakpoints: ["s3"] }));

    expect(screen.queryByTestId("breakpoint-plan")).toBeNull();
    expect(screen.getByTestId("breakpoint-review")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the breakpoint through the actions", () => {
    const actions = renderRail(makeRun(threeSteps()));

    fireEvent.click(screen.getByTestId("breakpoint-review"));

    expect(actions.setBreakpoint).toHaveBeenCalledWith("r1", "s3", true);
  });

  it("calls onToggle with the step id when a row head is clicked", () => {
    const onToggle = vi.fn();
    renderRail(makeRun(threeSteps()), { onToggle });

    fireEvent.click(screen.getByLabelText("plan, Done"));

    expect(onToggle).toHaveBeenCalledWith("s1");
  });

  it("shows the skill, prompt and actions for the expanded row", () => {
    renderRail(makeRun(threeSteps()), { expandedStepId: "s2" });

    expect(screen.getByText("Build it")).toBeInTheDocument();
    expect(screen.getByTestId("action-stopAfter-implement")).toBeInTheDocument();
  });

  it("shows the skill line when the step names one", () => {
    renderRail(makeRun(threeSteps()), { expandedStepId: "s1" });

    expect(screen.getByText("Skill: planner")).toBeInTheDocument();
    expect(screen.getByText("No actions right now.")).toBeInTheDocument();
  });

  it("stops after the step when its stop action is clicked", () => {
    const actions = renderRail(makeRun(threeSteps()), { expandedStepId: "s2" });

    fireEvent.click(screen.getByTestId("action-stopAfter-implement"));

    expect(actions.stop).toHaveBeenCalledWith("r1", "afterStep");
  });

  it("sends a review step back with the trimmed note", () => {
    const run = makeRun([step("s1", "done"), step("s2", "done"), step("s3", "needs_you")]);
    const actions = renderRail(run, { expandedStepId: "s3" });

    fireEvent.change(screen.getByTestId("sendback-note-review"), { target: { value: "  fix it  " } });
    fireEvent.click(screen.getByTestId("action-sendBack-review"));

    expect(actions.review).toHaveBeenCalledWith("r1", "sendBack", "fix it");
  });

  it("sends back without a note when the field is blank", () => {
    const run = makeRun([step("s3", "needs_you")]);
    const actions = renderRail(run, { expandedStepId: "s3" });

    fireEvent.click(screen.getByTestId("action-sendBack-review"));

    expect(actions.review).toHaveBeenCalledWith("r1", "sendBack", undefined);
  });

  it("approves a review step", () => {
    const actions = renderRail(makeRun([step("s3", "needs_you")]), { expandedStepId: "s3" });

    fireEvent.click(screen.getByTestId("action-approve-review"));

    expect(actions.review).toHaveBeenCalledWith("r1", "approve");
  });

  it("marks later steps as will-rerun while a redo card is open", () => {
    renderRail(makeRun(threeSteps()), { rerunFrom: "s2" });

    expect(screen.queryByTestId("will-rerun-plan")).toBeNull();
    expect(screen.getByTestId("will-rerun-implement")).toBeInTheDocument();
    expect(screen.getByTestId("will-redraw-implement")).toBeInTheDocument();
    expect(screen.getByTestId("will-rerun-review")).toBeInTheDocument();
    expect(screen.queryByTestId("will-redraw-review")).toBeNull();
  });

  it("tags a step kept from an earlier attempt and shows its diff stat", () => {
    const steps = [step("s1", "done", { fromAttempt: 1, diffStat: "+3 -1" })];
    renderRail(makeRun(steps));

    expect(screen.getByTestId("kept-plan")).toHaveTextContent("from attempt 1");
    expect(screen.getByText("+3 -1")).toBeInTheDocument();
  });

  it("is read-only for an earlier attempt: no breakpoints, no actions, no current marker", () => {
    renderRail(makeRun(threeSteps()), { readOnly: true, expandedStepId: "s2" });

    expect(screen.queryByTestId("breakpoint-review")).toBeNull();
    expect(screen.queryByTestId("action-stopAfter-implement")).toBeNull();
    expect(screen.getByTestId("step-row-implement")).not.toHaveAttribute("data-current");
  });
});
