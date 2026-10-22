import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunsList } from "./RunsList";
import type { Run, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

const workflow: WorkflowDef = {
  id: "wf",
  name: "Ship",
  steps: [{ id: "s1", slug: "Check", kind: "review", prompt: "" }],
};

const run = (over: Partial<Run>): Run => ({
  id: "r1",
  workflowId: "wf",
  state: "needs_you",
  currentStepId: "s1",
  stopAfter: null,
  attempt: 1,
  attempts: [],
  breakpoints: [],
  steps: [{ stepId: "s1", attempt: 1, status: "needs_you", output: "", diffStat: null, checkpointRef: null, sessionId: null }],
  ...over,
});

function setup(runs: Run[]) {
  const actions = { stop: vi.fn() } as unknown as WorkflowActions;
  const onOpen = vi.fn();
  const onEdit = vi.fn();
  render(
    <RunsList runs={runs} workflows={[workflow]} activeRunId={null} layout="full" actions={actions} onOpen={onOpen} onEdit={onEdit} onRun={vi.fn()} />,
  );
  return { actions, onOpen, onEdit };
}

describe("RunsList", () => {
  afterEach(cleanup);

  it("opens a run when the card background is clicked but not when a button is", () => {
    const { onOpen } = setup([run({ state: "running", steps: [{ stepId: "s1", attempt: 1, status: "running", output: "", diffStat: null, checkpointRef: null, sessionId: null }] })]);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("run-row-r1"));

    expect(onOpen).toHaveBeenCalledWith("r1");
  });

  it("opens a saved workflow for editing from its card background", () => {
    const { onEdit } = setup([]);

    fireEvent.click(screen.getByTestId("saved-wf"));

    expect(onEdit).toHaveBeenCalledWith(workflow);
  });

  it("lets a run awaiting review be cancelled", () => {
    const { actions } = setup([run({})]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    expect(actions.stop).toHaveBeenCalledWith("r1", "now");
  });
});
