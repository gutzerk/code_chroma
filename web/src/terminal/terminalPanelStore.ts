import { useSyncExternalStore } from "react";
import { PanelStore, useIsPanelOpen } from "../canvas/panelStore";

const DEFAULT_AGENT = "shell";

/** Global terminal-panel store: the shared PanelStore open/closed half plus agent selection.
 * In-memory only, resets on reload — same FR-018 precedent as ExpansionStore. */
class TerminalPanelStore extends PanelStore {
  private selectedAgentState: string = DEFAULT_AGENT;

  getSelectedAgent = (): string => this.selectedAgentState;

  selectAgent = (agent: string): void => {
    this.selectedAgentState = agent;
    this.emit();
  };

  /** Test/dev-only full reset. */
  reset = (): void => {
    this.selectedAgentState = DEFAULT_AGENT;
    this.closePanel();
  };
}

export const terminalPanelStore = new TerminalPanelStore().markGlobalStore();

export function useIsTerminalPanelOpen(): boolean {
  return useIsPanelOpen(terminalPanelStore);
}

export function useSelectedAgent(): string {
  return useSyncExternalStore(terminalPanelStore.subscribe, terminalPanelStore.getSelectedAgent);
}
