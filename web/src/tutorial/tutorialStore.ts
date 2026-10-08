import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";
import { TUTORIAL_STEPS, type TutorialStep } from "./tutorialSteps";

class TutorialStore extends Store {
  private active = false;
  private stepIndex = 0;

  isActive = (): boolean => this.active;

  getStepIndex = (): number => this.stepIndex;

  currentStepId = (): string | null => (this.active ? TUTORIAL_STEPS[this.stepIndex].id : null);

  start = (): void => {
    this.active = true;
    this.stepIndex = 0;
    this.emit();
  };

  next = (): void => {
    if (!this.active) return;
    if (this.stepIndex >= TUTORIAL_STEPS.length - 1) {
      this.active = false;
    } else {
      this.stepIndex += 1;
    }
    this.emit();
  };

  /** Jumps to the first step of `stage`; a stage with no steps yet is ignored. */
  goToStage = (stage: number): void => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.stage === stage);
    if (!this.active || index === -1) return;
    this.stepIndex = index;
    this.emit();
  };

  reset = (): void => {
    this.active = false;
    this.stepIndex = 0;
    this.emit();
  };
}

export const tutorialStore = new TutorialStore().markGlobalStore();

/** Advances only when the tutorial is still on `stepId`, so a late simulation callback is harmless. */
export function advanceTutorialFrom(stepId: string): void {
  if (tutorialStore.currentStepId() === stepId) tutorialStore.next();
}

export function useTutorialStep(): TutorialStep | null {
  const active = useSyncExternalStore(tutorialStore.subscribe, tutorialStore.isActive);
  const index = useSyncExternalStore(tutorialStore.subscribe, tutorialStore.getStepIndex);
  return active ? TUTORIAL_STEPS[index] : null;
}

export function useTutorialActive(): boolean {
  return useSyncExternalStore(tutorialStore.subscribe, tutorialStore.isActive);
}
