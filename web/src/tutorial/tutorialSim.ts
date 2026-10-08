import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

export type SimWikiState = "idle" | "running" | "done";
export type SimAgentState = "closed" | "open";
export type SimAgent2State = "none" | "working" | "done";
export type SimScene = "feature" | "second" | "explain";

const WIKI_DURATION_MS = 4000;
const WIKI_TICK_MS = 100;

interface SimSnapshot {
  wiki: SimWikiState;
  wikiPercent: number;
  agent: SimAgentState;
  /** True once the tutorial project is open: its prebuilt diagrams stay hidden until drawn. */
  gateOn: boolean;
  revealed: readonly string[];
  /** The first agent (the one that drew the diagram) is listed in the agents panel. */
  agent1Listed: boolean;
  agent2: SimAgent2State;
  agent2Window: boolean;
  /** Id of the feature picked in the first agent's window; null until then. */
  feature: string | null;
  /** The next exchange the first agent's terminal should play. */
  scene: SimScene | null;
  /** The wiki notice was already shown and dismissed (a lesson that starts after stage 2). */
  wikiAcked: boolean;
  /** The canvas has been set up for the current stage, so a step may watch it. */
  stageReady: boolean;
  /** Bumped when the agents panel must go back to its first tab. */
  railResets: number;
  /** The pull request was opened from the dialog; `prImpact` is whether its impact box was ticked. */
  pr: "none" | "opened";
  prImpact: boolean;
}

const INITIAL: SimSnapshot = {
  wiki: "idle",
  wikiPercent: 0,
  agent: "closed",
  gateOn: false,
  revealed: [],
  agent1Listed: false,
  agent2: "none",
  agent2Window: false,
  feature: null,
  scene: null,
  wikiAcked: false,
  stageReady: false,
  railResets: 0,
  pr: "none",
  prImpact: false,
};

/** Fake wiki build and fake agent window used only while the tutorial runs; never calls a model. */
class TutorialSimStore extends Store {
  private snapshot: SimSnapshot = INITIAL;
  private timer: number | null = null;
  private fitAll: (() => void) | null = null;

  getSnapshot = (): SimSnapshot => this.snapshot;

  setFitAll = (fitAll: (() => void) | null): void => {
    this.fitAll = fitAll;
  };

  fitCanvas = (): void => this.fitAll?.();

  private fitSelector: ((selector: string) => boolean) | null = null;

  setFitSelector = (fit: ((selector: string) => boolean) | null): void => {
    this.fitSelector = fit;
  };

  /** Zooms the canvas in on the elements matching the selector; false while they are not laid out. */
  zoomToSelector = (selector: string): boolean => this.fitSelector?.(selector) ?? false;

  private set(patch: Partial<SimSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  startWiki = (onDone: () => void): void => {
    if (this.snapshot.wiki !== "idle") return;
    this.set({ wiki: "running", wikiPercent: 0 });
    const startedAt = Date.now();
    this.timer = window.setInterval(() => {
      const percent = Math.min(100, ((Date.now() - startedAt) / WIKI_DURATION_MS) * 100);
      if (percent < 100) {
        this.set({ wikiPercent: percent });
        return;
      }
      this.clearTimer();
      this.set({ wiki: "done", wikiPercent: 100 });
      onDone();
    }, WIKI_TICK_MS);
  };

  enableGate = (): void => this.set({ gateOn: true });

  reveal = (kind: string): void => this.set({ revealed: [...this.snapshot.revealed, kind] });

  isHidden = (kind: string): boolean =>
    this.snapshot.gateOn && !this.snapshot.revealed.includes(kind);

  openAgent = (): void => this.set({ agent: "open", agent2Window: false });

  closeAgent = (): void => this.set({ agent: "closed" });

  listAgent1 = (): void => this.set({ agent1Listed: true });

  openAgent2Window = (): void => this.set({ agent2Window: true, agent: "closed" });

  /** The second agent starts working on the planned feature in its own window. */
  startAgent2 = (): void => this.set({ agent2: "working", agent2Window: true, agent: "closed" });

  openPr = (impact: boolean): void => this.set({ pr: "opened", prImpact: impact });

  finishAgent2 = (): void => this.set({ agent2: "done" });

  setFeature = (feature: string | null): void => this.set({ feature });

  /** Puts every simulated thing into the state the given stage starts with. */
  beginStage = (stage: number): void => {
    this.clearTimer();
    this.snapshot = {
      ...INITIAL,
      gateOn: this.snapshot.gateOn,
      railResets: this.snapshot.railResets + 1,
      wiki: stage >= 3 ? "done" : "idle",
      wikiPercent: stage >= 3 ? 100 : 0,
      wikiAcked: stage >= 3,
      revealed: stage === 3 || stage === 4 ? ["patterns"] : [],
      agent1Listed: stage === 4,
    };
    this.emit();
  };

  endStage = (): void => this.set({ stageReady: true });

  requestScene = (scene: SimScene | null): void => this.set({ scene });

  private clearTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  reset = (): void => {
    this.clearTimer();
    this.snapshot = { ...INITIAL, gateOn: this.snapshot.gateOn };
    this.emit();
  };
}

export const tutorialSimStore = new TutorialSimStore();

export function useTutorialSim(): SimSnapshot {
  return useSyncExternalStore(tutorialSimStore.subscribe, tutorialSimStore.getSnapshot);
}
