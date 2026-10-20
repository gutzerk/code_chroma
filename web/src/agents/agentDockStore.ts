import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

const EMPTY: readonly string[] = [];
const COLLAPSED_STORAGE_KEY = "codechroma.agentDockCollapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

class AgentDockStore extends Store {
  private agentIds: readonly string[] = EMPTY;
  private activeAgentId: string | null = null;
  private collapsed = readCollapsed();
  private focusRequest = 0;

  getAgentIds = (): readonly string[] => this.agentIds;

  getActiveAgentId = (): string | null => this.activeAgentId;

  getIsCollapsed = (): boolean => this.collapsed;

  getFocusRequest = (): number => this.focusRequest;

  private setCollapsed(collapsed: boolean): void {
    if (this.collapsed !== collapsed) {
      this.collapsed = collapsed;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
      } catch {
        // The panel remains usable when browser storage is unavailable.
      }
    }
    this.emit();
  }

  toggleCollapsed = (): void => this.setCollapsed(!this.collapsed);

  expand = (): void => {
    if (this.collapsed) this.setCollapsed(false);
  };

  openAndFocus = (): void => {
    if (this.agentIds.length === 0) return;
    this.focusRequest += 1;
    this.setCollapsed(false);
  };

  attach = (id: string): void => {
    if (this.agentIds.includes(id)) {
      this.activate(id);
      return;
    }
    this.agentIds = [...this.agentIds, id];
    this.activeAgentId = id;
    this.emit();
  };

  activate = (id: string): void => {
    if (!this.agentIds.includes(id) || this.activeAgentId === id) return;
    this.activeAgentId = id;
    this.emit();
  };

  detach = (id: string): void => {
    if (!this.agentIds.includes(id)) return;
    this.agentIds = this.agentIds.filter((agentId) => agentId !== id);
    if (this.activeAgentId === id) {
      this.activeAgentId = this.agentIds.at(-1) ?? null;
    }
    this.emit();
  };

  retain = (ids: readonly string[]): void => {
    const next = this.agentIds.filter((id) => ids.includes(id));
    if (next.length === this.agentIds.length) return;
    this.agentIds = next;
    if (!next.includes(this.activeAgentId ?? "")) {
      this.activeAgentId = next.at(-1) ?? null;
    }
    this.emit();
  };

  reset = (): void => {
    this.agentIds = EMPTY;
    this.activeAgentId = null;
    this.collapsed = readCollapsed();
    this.emit();
  };
}

export const agentDockStore = new AgentDockStore().markGlobalStore();

export function useDockedAgentIds(): readonly string[] {
  return useSyncExternalStore(agentDockStore.subscribe, agentDockStore.getAgentIds);
}

export function useActiveDockedAgentId(): string | null {
  return useSyncExternalStore(agentDockStore.subscribe, agentDockStore.getActiveAgentId);
}

export function useIsAgentDockCollapsed(): boolean {
  return useSyncExternalStore(agentDockStore.subscribe, agentDockStore.getIsCollapsed);
}

export function useAgentDockFocusRequest(): number {
  return useSyncExternalStore(agentDockStore.subscribe, agentDockStore.getFocusRequest);
}
