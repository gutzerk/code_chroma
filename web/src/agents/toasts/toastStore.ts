import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { AgentStatus } from "../../state/types";
import { DONE_AUTO_CLOSE_MS } from "../agentNotifications";
import type { AttentionStatus } from "../statusRollup";

export interface AgentToast {
  agentId: string;
  kind: AttentionStatus;
  title: string;
  body: string;
}

const NONE: AgentToast[] = [];

/** At most one toast per agent, newest last; each lives only while its agent stays in its status, a `done` one at most DONE_AUTO_CLOSE_MS. */
class AgentToastStore extends Store {
  private toasts: AgentToast[] = NONE;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  getToasts = (): AgentToast[] => this.toasts;

  show = (toast: AgentToast): void => {
    this.clearTimer(toast.agentId);
    this.toasts = [...this.toasts.filter((t) => t.agentId !== toast.agentId), toast];
    if (toast.kind === "done") {
      this.timers.set(toast.agentId, setTimeout(() => this.dismiss(toast.agentId), DONE_AUTO_CLOSE_MS));
    }
    this.emit();
  };

  dismiss = (agentId: string): void => {
    this.clearTimer(agentId);
    if (!this.toasts.some((t) => t.agentId === agentId)) return;
    this.toasts = this.toasts.filter((t) => t.agentId !== agentId);
    this.emit();
  };

  /** Drops every toast whose agent left the toast's status (answered, restarted, seen) or is gone. */
  reconcile = (statuses: ReadonlyMap<string, AgentStatus>): void => {
    const stale = this.toasts.filter((t) => statuses.get(t.agentId) !== t.kind);
    stale.forEach((t) => this.dismiss(t.agentId));
  };

  private clearTimer(agentId: string): void {
    clearTimeout(this.timers.get(agentId));
    this.timers.delete(agentId);
  }

  reset = (): void => {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.toasts = NONE;
    this.emit();
  };
}

export const agentToastStore = new AgentToastStore().markGlobalStore();

export function useAgentToasts(): AgentToast[] {
  return useSyncExternalStore(agentToastStore.subscribe, agentToastStore.getToasts);
}
