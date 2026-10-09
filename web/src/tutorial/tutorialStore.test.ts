import { beforeEach, describe, expect, it } from "vitest";
import { tutorialStore } from "./tutorialStore";
import { TUTORIAL_STEPS } from "./tutorialSteps";

beforeEach(() => tutorialStore.reset());

describe("tutorialStore", () => {
  it("starts on the first step", () => {
    tutorialStore.start();

    expect(tutorialStore.isActive()).toBe(true);
    expect(tutorialStore.getStepIndex()).toBe(0);
  });

  it("finishes after the last step", () => {
    tutorialStore.start();

    for (let i = 0; i < TUTORIAL_STEPS.length; i += 1) tutorialStore.next();

    expect(tutorialStore.isActive()).toBe(false);
  });

  it("ignores next when not started", () => {
    tutorialStore.next();

    expect(tutorialStore.getStepIndex()).toBe(0);
  });
});

describe("tutorialStore.goToStage", () => {
  it("jumps back to the first step of an implemented stage", () => {
    tutorialStore.start();
    tutorialStore.next();
    tutorialStore.next();

    tutorialStore.goToStage(1);

    expect(tutorialStore.getStepIndex()).toBe(0);
  });

  it("ignores a stage that does not exist", () => {
    tutorialStore.start();

    tutorialStore.goToStage(6);

    expect(tutorialStore.getStepIndex()).toBe(0);
  });

  it("jumps to the pull-request stage, which opens with the GitHub CLI note", () => {
    tutorialStore.reset();
    tutorialStore.start();

    tutorialStore.goToStage(5);

    expect(tutorialStore.currentStepId()).toBe("gh-cli");
  });
});

describe("tutorialStore stage 3", () => {
  it("jumps to the first step of the diagram-handling stage", () => {
    tutorialStore.reset();
    tutorialStore.start();

    tutorialStore.goToStage(3);

    expect(tutorialStore.currentStepId()).toBe("move-block");
  });
});
