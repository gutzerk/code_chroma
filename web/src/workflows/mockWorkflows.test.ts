import { describe, expect, it } from "vitest";
import { MockWorkflowEngine } from "./mockWorkflows";
import type { RunEvent } from "./types";

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
    mock.stop(run.id, "now");
    expect(mock.getRun(run.id).state).toBe("paused");
  });
});
