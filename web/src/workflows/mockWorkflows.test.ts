import { describe, expect, it } from "vitest";
import { MockWorkflowEngine } from "./mockWorkflows";
import type { RunEvent, WorkflowDef } from "./types";

function engine() {
  const events: RunEvent[] = [];
  return { events, mock: new MockWorkflowEngine((e) => events.push(e), 0) };
}

describe("MockWorkflowEngine transitions", () => {
  it("runs to done, blocking on the review step", () => {
    const { mock } = engine();
    const run = mock.startRun("ship-feature");
    mock.advance(run.id);
    mock.advance(run.id);

    expect(mock.getRun(run.id).state).toBe("needs_you");
    mock.review(run.id, "approve");
    mock.advance(run.id);
    expect(mock.getRun(run.id).state).toBe("done");
  });

  it("stop(afterStep) holds at the next step and clears stopAfter", () => {
    const { mock } = engine();
    const run = mock.startRun("ship-feature");

    mock.stop(run.id, "afterStep");
    expect(mock.getRun(run.id).stopAfter).toBe("s1");
    mock.advance(run.id);

    const after = mock.getRun(run.id);
    expect(after.state).toBe("held");
    expect(after.stopAfter).toBeNull();
    expect(after.steps[1].status).toBe("held");
  });

  it("stop(now) leaves a stopped run that resumeFrom restarts", () => {
    const { mock, events } = engine();
    const run = mock.startRun("ship-feature");

    mock.stop(run.id, "now");
    expect(mock.getRun(run.id).state).toBe("stopped");
    mock.resumeFrom(run.id, "s1");

    expect(mock.getRun(run.id).state).toBe("running");
    expect(events.map((e) => e.event)).toContain("run.stopping");
    expect(events.map((e) => e.event)).toContain("run.stopped");
  });

  it("ignores illegal commands", () => {
    const { mock } = engine();
    const run = mock.startRun("ship-feature");

    mock.resume(run.id);
    expect(mock.getRun(run.id).state).toBe("running");
    mock.pause(run.id);
    mock.stop(run.id, "afterStep");
    expect(mock.getRun(run.id).state).toBe("paused");
  });

  it("cancels a paused run like the bridge's StopNow row", () => {
    const { mock } = engine();
    const run = mock.startRun("ship-feature");

    mock.pause(run.id);
    mock.stop(run.id, "now");

    expect(mock.getRun(run.id).state).toBe("stopped");
  });
});

describe("MockWorkflowEngine management", () => {
  function finishedRun(mock: MockWorkflowEngine) {
    const run = mock.startRun("ship-feature");
    mock.stop(run.id, "now");
    return run;
  }

  it("updateWorkflow replaces a known definition and rejects an unknown one", () => {
    const { mock } = engine();
    const def: WorkflowDef = { id: "ship-feature", name: "Renamed", steps: [{ id: "a", slug: "a", kind: "review", prompt: "" }] };

    mock.updateWorkflow(def);

    expect(mock.listWorkflows()[0].name).toBe("Renamed");
    expect(() => mock.updateWorkflow({ ...def, id: "nope" })).toThrow(/unknown workflow/);
  });

  it("deleteRun removes only finished runs and emits run.deleted", () => {
    const { mock, events } = engine();
    const active = mock.startRun("ship-feature");
    const stopped = finishedRun(mock);

    expect(() => mock.deleteRun(active.id)).toThrow("Only a finished run can be deleted");
    mock.deleteRun(stopped.id);

    expect(mock.listRuns().map((r) => r.id)).toEqual([active.id]);
    expect(events.at(-1)?.event).toBe("run.deleted");
  });

  it("clearFinished drops done and stopped runs only", () => {
    const { mock } = engine();
    const active = mock.startRun("ship-feature");
    finishedRun(mock);

    mock.clearFinished();

    expect(mock.listRuns().map((r) => r.id)).toEqual([active.id]);
  });

  it("restartRun resets the same run to step 1 keeping id and inputs", () => {
    const { mock } = engine();
    const run = finishedRun(mock);
    mock.message(run.id, "run", "hello");

    const again = mock.restartRun(run.id);

    expect(again.id).toBe(run.id);
    expect(again.state).toBe("running");
    expect(again.currentStepId).toBe("s1");
    expect(again.messages).toEqual([]);
    expect(again.attempts).toHaveLength(1);
    expect(again.steps[1].status).toBe("pending");
  });

  it("restartRun refuses a run that is still going", () => {
    const { mock } = engine();
    const run = mock.startRun("ship-feature");

    expect(() => mock.restartRun(run.id)).toThrow(/finished/);
  });

  it("a pauseBefore step becomes a breakpoint that holds the run", () => {
    const { mock } = engine();
    mock.createWorkflow({
      id: "pb",
      name: "PB",
      steps: [
        { id: "x1", slug: "one", kind: "agent", prompt: "a" },
        { id: "x2", slug: "two", kind: "agent", prompt: "b", pauseBefore: true },
      ],
    });
    const run = mock.startRun("pb");

    mock.advance(run.id);

    const held = mock.getRun(run.id);
    expect(held.breakpoints).toEqual(["x2"]);
    expect(held.state).toBe("held");
  });

  it("a review step with an empty prompt still blocks on the human", () => {
    const { mock } = engine();
    mock.createWorkflow({ id: "r", name: "R", steps: [{ id: "q", slug: "look", kind: "review", prompt: "" }] });

    const run = mock.startRun("r");

    expect(run.state).toBe("needs_you");
  });
});
