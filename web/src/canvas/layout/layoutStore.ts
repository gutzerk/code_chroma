import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

export type LeftTab = "diagrams" | "files";
export type AgentsMode = "normal" | "collapsed" | "full";
export type AgentsWidth = "default" | "wide";

export interface LayoutState {
  leftOpen: boolean;
  leftTab: LeftTab;
  agentsMode: AgentsMode;
  agentsWidth: AgentsWidth;
  selectedAgentId: string | null;
}

const INITIAL: LayoutState = {
  leftOpen: true,
  leftTab: "diagrams",
  agentsMode: "normal",
  agentsWidth: "default",
  selectedAgentId: null,
};

/** Shared canvas chrome layout: left panel open/tab and agents panel mode; global (survives workspace switches). */
class LayoutStore extends Store {
  private state: LayoutState = INITIAL;
  // The left panel's open state from before entering full, restored when leaving it.
  private leftOpenBeforeFull: boolean | null = null;

  getState = (): LayoutState => this.state;

  private set(patch: Partial<LayoutState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  openLeft = (tab?: LeftTab): void => {
    this.leftOpenBeforeFull = null;
    this.set({
      leftOpen: true,
      leftTab: tab ?? this.state.leftTab,
      agentsMode: this.state.agentsMode === "full" ? "normal" : this.state.agentsMode,
    });
  };

  closeLeft = (): void => this.set({ leftOpen: false });

  toggleLeft = (): void => {
    if (this.state.leftOpen) this.closeLeft();
    else this.openLeft();
  };

  setAgentsMode = (mode: AgentsMode): void => {
    const wasFull = this.state.agentsMode === "full";
    if (mode === "full") {
      if (!wasFull) this.leftOpenBeforeFull = this.state.leftOpen;
      this.set({ agentsMode: mode, leftOpen: false });
      return;
    }
    const restored = wasFull ? this.leftOpenBeforeFull : null;
    this.leftOpenBeforeFull = null;
    this.set(restored === null ? { agentsMode: mode } : { agentsMode: mode, leftOpen: restored });
  };


  toggleAgentsWide = (): void =>
    this.set({ agentsWidth: this.state.agentsWidth === "wide" ? "default" : "wide" });

  selectAgent = (id: string | null): void => this.set({ selectedAgentId: id });

  /** Drops a selection whose agent no longer exists. */
  reconcileAgents = (liveIds: readonly string[]): void => {
    const { selectedAgentId } = this.state;
    if (selectedAgentId !== null && !liveIds.includes(selectedAgentId)) this.selectAgent(null);
  };

  reset = (): void => {
    this.state = INITIAL;
    this.leftOpenBeforeFull = null;
    this.emit();
  };
}

export const layoutStore = new LayoutStore().markGlobalStore();

export function useLayoutState(): LayoutState {
  return useSyncExternalStore(layoutStore.subscribe, layoutStore.getState);
}
