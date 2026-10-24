import { useSyncExternalStore } from "react";
import { PanelStore, useIsPanelOpen } from "../canvas/panelStore";

const DEFAULT_AGENT = "shell";

export interface TerminalTab {
  id: number;
  title: string;
}

/** Global terminal-panel store: the shared PanelStore open/closed half plus agent selection.
 * In-memory only, resets on reload — same FR-018 precedent as ExpansionStore. */
class TerminalPanelStore extends PanelStore {
  private selectedAgentState: string = DEFAULT_AGENT;
  private tabs: TerminalTab[] = [{ id: 1, title: "Terminal 1" }];
  private activeTab = 1;
  private nextId = 2;

  getTabs = (): TerminalTab[] => this.tabs;
  getActiveTab = (): number => this.activeTab;

  addTerminal = (): void => {
    const id = this.nextId++;
    this.tabs = [...this.tabs, { id, title: `Terminal ${id}` }];
    this.activeTab = id;
    this.openPanel();
  };

  selectTerminal = (id: number): void => {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    this.activeTab = id;
    this.emit();
  };

  closeTerminal = (id: number): void => {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.tabs = this.tabs.filter((tab) => tab.id !== id);
    if (this.activeTab === id) this.activeTab = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? 0;
    if (this.tabs.length === 0) this.closePanel();
    else this.emit();
  };

  hide = (): void => this.closePanel();

  open = (): void => {
    if (this.tabs.length === 0) {
      this.addTerminal();
      return;
    }
    this.openPanel();
  };

  toggle = (): void => {
    if (this.getIsOpen()) this.hide();
    else this.open();
  };

  getSelectedAgent = (): string => this.selectedAgentState;

  selectAgent = (agent: string): void => {
    this.selectedAgentState = agent;
    this.emit();
  };

  /** Test/dev-only full reset. */
  reset = (): void => {
    this.selectedAgentState = DEFAULT_AGENT;
    this.tabs = [{ id: 1, title: "Terminal 1" }];
    this.activeTab = 1;
    this.nextId = 2;
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

export function useTerminalTabs(): TerminalTab[] {
  return useSyncExternalStore(terminalPanelStore.subscribe, terminalPanelStore.getTabs);
}

export function useActiveTerminalTab(): number {
  return useSyncExternalStore(terminalPanelStore.subscribe, terminalPanelStore.getActiveTab);
}
