import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

export type LeftTab = "diagrams" | "files";
export type AgentsMode = "normal" | "collapsed" | "full";

export interface LayoutState {
  leftOpen: boolean;
  leftTab: LeftTab;
  agentsMode: AgentsMode;
  selectedAgentId: string | null;
}

const INITIAL: LayoutState = {
  leftOpen: true,
  leftTab: "diagrams",
  agentsMode: "normal",
  selectedAgentId: null,
};

/** Shared canvas chrome layout: left panel open/tab and agents panel mode; global (survives workspace switches). */
class LayoutStore extends Store {
  private state: LayoutState = INITIAL;

  getState = (): LayoutState => this.state;

  private set(patch: Partial<LayoutState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  openLeft = (tab?: LeftTab): void => {
    this.set({ leftOpen: true, leftTab: tab ?? this.state.leftTab });
  };

  closeLeft = (): void => this.set({ leftOpen: false });

  toggleLeft = (): void => {
    if (this.state.leftOpen) this.closeLeft();
    else this.openLeft();
  };

  /** Full screen leaves the left panel as it is: the agents panel stretches to whichever edge is showing. */
  setAgentsMode = (mode: AgentsMode): void => this.set({ agentsMode: mode });

  toggleAgentsFull = (): void => this.set({ agentsMode: this.state.agentsMode === "full" ? "normal" : "full" });

  selectAgent = (id: string | null): void => this.set({ selectedAgentId: id });

  /** Drops a selection whose agent no longer exists. */
  reconcileAgents = (liveIds: readonly string[]): void => {
    const { selectedAgentId } = this.state;
    if (selectedAgentId !== null && !liveIds.includes(selectedAgentId)) this.selectAgent(null);
  };

  reset = (): void => {
    this.state = INITIAL;
    this.emit();
  };
}

export const layoutStore = new LayoutStore().markGlobalStore();

export function useLayoutState(): LayoutState {
  return useSyncExternalStore(layoutStore.subscribe, layoutStore.getState);
}
