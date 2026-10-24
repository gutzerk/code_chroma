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
  const actions = {} as unknown as WorkflowActions;
  const onOpen = vi.fn();
  render(<RunsList runs={runs} workflows={[workflow]} activeRunId={null} layout="full" actions={actions} onOpen={onOpen} />);
  return { actions, onOpen };
}

describe("RunsList", () => {
  afterEach(cleanup);

  it("opens a run when its card is clicked", () => {
    const { onOpen } = setup([run({ state: "running", steps: [{ stepId: "s1", attempt: 1, status: "running", output: "", diffStat: null, checkpointRef: null, sessionId: null }] })]);

    fireEvent.click(screen.getByRole("button", { name: /Open run r1/ }));

    expect(onOpen).toHaveBeenCalledWith("r1");
  });

  it("has no saved workflows section; those live on the All workflows screen", () => {
    setup([]);

    expect(screen.queryByRole("list", { name: "Saved workflows" })).toBeNull();
  });
});
