import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

const EMPTY: readonly string[] = [];

class AgentDockStore extends Store {
  private agentIds: readonly string[] = EMPTY;
  private activeAgentId: string | null = null;

  getAgentIds = (): readonly string[] => this.agentIds;

  getActiveAgentId = (): string | null => this.activeAgentId;

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
