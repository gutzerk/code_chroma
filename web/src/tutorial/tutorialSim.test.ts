import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorialSimStore } from "./tutorialSim";

beforeEach(() => {
  vi.useFakeTimers();
  tutorialSimStore.reset();
});

afterEach(() => {
  tutorialSimStore.reset();
  vi.useRealTimers();
});

describe("tutorialSimStore", () => {
  it("finishes the fake wiki build and reports done once", () => {
    const onDone = vi.fn();

    tutorialSimStore.startWiki(onDone);
    vi.advanceTimersByTime(5000);

    expect(tutorialSimStore.getSnapshot().wiki).toBe("done");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ignores a second start while running", () => {
    const onDone = vi.fn();
    tutorialSimStore.startWiki(onDone);

    tutorialSimStore.startWiki(onDone);
    vi.advanceTimersByTime(5000);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the fake agent", () => {
    tutorialSimStore.openAgent();
    tutorialSimStore.closeAgent();

    expect(tutorialSimStore.getSnapshot().agent).toBe("closed");
  });

  it("starts the second agent in its own window and finishes it", () => {
    tutorialSimStore.openAgent();

    tutorialSimStore.startAgent2();
    tutorialSimStore.finishAgent2();

    expect(tutorialSimStore.getSnapshot()).toMatchObject({
      agent: "closed",
      agent2Window: true,
      agent2: "done",
      agent1Listed: false,
    });
  });

  it("opens a pull request with or without its impact diagram", () => {
    tutorialSimStore.openPr(true);

    expect(tutorialSimStore.getSnapshot()).toMatchObject({ pr: "opened", prImpact: true });
  });

  it.each([
    [1, { revealed: [], agent1Listed: false, wiki: "idle" }],
    [3, { revealed: ["patterns"], agent1Listed: false, wiki: "done" }],
    [4, { revealed: ["patterns"], agent1Listed: true, wiki: "done" }],
    [5, { revealed: [], agent1Listed: false, wiki: "done", pr: "none", prImpact: false }],
  ])("starts stage %i from its fixed scene", (stage, expected) => {
    tutorialSimStore.startAgent2();
    tutorialSimStore.setFeature("search");

    tutorialSimStore.beginStage(stage);

    expect(tutorialSimStore.getSnapshot()).toMatchObject({
      ...expected,
      agent: "closed",
      agent2: "none",
      agent2Window: false,
      feature: null,
      stageReady: false,
    });
  });
});
