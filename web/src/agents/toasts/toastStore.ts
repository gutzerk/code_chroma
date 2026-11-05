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

/** At most one toast per agent, newest last; each lives only while its agent stays in its status, a `done` one at most DONE_AUTO_CLOSE_MS of unheld time. */
class AgentToastStore extends Store {
  private toasts: AgentToast[] = NONE;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deadlines = new Map<string, number>();
  private remaining = new Map<string, number>();
  private held = new Set<string>();

  getToasts = (): AgentToast[] => this.toasts;

  show = (toast: AgentToast): void => {
    this.clearTimer(toast.agentId);
    this.remaining.delete(toast.agentId);
    this.toasts = [...this.toasts.filter((t) => t.agentId !== toast.agentId), toast];
    if (toast.kind === "done") {
      if (this.held.has(toast.agentId)) this.remaining.set(toast.agentId, DONE_AUTO_CLOSE_MS);
      else this.startTimer(toast.agentId, DONE_AUTO_CLOSE_MS);
    }
    this.emit();
  };

  /** Pauses a done toast's auto-close while the pointer or focus is on it, and resumes it with the time left. */
  hold = (agentId: string, held: boolean): void => {
    if (held) {
      if (this.held.has(agentId)) return;
      this.held.add(agentId);
      const deadline = this.deadlines.get(agentId);
      if (deadline === undefined) return;
      this.clearTimer(agentId);
      this.remaining.set(agentId, Math.max(0, deadline - Date.now()));
      return;
    }
    if (!this.held.delete(agentId)) return;
    const left = this.remaining.get(agentId);
    this.remaining.delete(agentId);
    if (left !== undefined) this.startTimer(agentId, left);
  };

  dismiss = (agentId: string): void => {
    this.clearTimer(agentId);
    this.remaining.delete(agentId);
    this.held.delete(agentId);
    if (!this.toasts.some((t) => t.agentId === agentId)) return;
    this.toasts = this.toasts.filter((t) => t.agentId !== agentId);
    this.emit();
  };

  /** Drops every toast whose agent left the toast's status (answered, restarted, seen) or is gone. */
  reconcile = (statuses: ReadonlyMap<string, AgentStatus>): void => {
    const stale = this.toasts.filter((t) => statuses.get(t.agentId) !== t.kind);
    stale.forEach((t) => this.dismiss(t.agentId));
  };

  private startTimer(agentId: string, ms: number): void {
    this.deadlines.set(agentId, Date.now() + ms);
    this.timers.set(agentId, setTimeout(() => this.dismiss(agentId), ms));
  }

  private clearTimer(agentId: string): void {
    clearTimeout(this.timers.get(agentId));
    this.timers.delete(agentId);
    this.deadlines.delete(agentId);
  }

  reset = (): void => {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.deadlines.clear();
    this.remaining.clear();
    this.held.clear();
    this.toasts = NONE;
    this.emit();
  };
}

export const agentToastStore = new AgentToastStore().markGlobalStore();

export function useAgentToasts(): AgentToast[] {
  return useSyncExternalStore(agentToastStore.subscribe, agentToastStore.getToasts);
}
