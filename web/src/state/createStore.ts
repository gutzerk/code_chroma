export type Listener = () => void;

/** Reference-equality guard for derived array snapshots: two stores (selection, expansion) keep a
 * stable `getSnapshot()` by only replacing their cache when its contents change. Shared here so
 * the identical comparisons in both stores stay in one place. */
export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Anything resetWorkspaceStores() can reset — a Store subclass, or any object with a reset(). */
export interface Resettable {
  reset(): void;
}

const workspaceStores = new Set<Resettable>();

/**
 * Inverted registration: a Store registers itself workspace-scoped in its constructor, so a new
 * store that forgets to opt out can no longer silently keep the previous worktree's data across a
 * switch. The few that must survive a switch — the agent/workspace/branch/PR stores (resetting
 * agentStore would undo the very switch that triggered the reset), plus codeViewMode/panel-open
 * user chrome — call markGlobalStore() to drop out of the reset set.
 */
export function resetWorkspaceStores(): void {
  workspaceStores.forEach((store) => store.reset());
}

/** Enrols workspace-scoped state that isn't a Store — the diff scheduler's single-flight flags are
 * the one case, and they leak the previous worktree's run across a switch exactly like a store's
 * data would. A Store registers itself in its constructor and never calls this. */
export function registerWorkspaceStore(resettable: Resettable): void {
  workspaceStores.add(resettable);
}

/**
 * The listener plumbing every canvas store used to re-type by hand: one listener set, a
 * `subscribe` shaped for useSyncExternalStore (arrow property, so it can be passed unbound), and
 * a protected `emit`. A subclass calls `emit()` after each mutation — directly, or at the end of
 * its own snapshot-rebuilding `notify()` where it caches stable references first.
 *
 * Every Store is workspace-scoped by construction (removed from the reset set is the opt-out
 * rather than the opt-in); markGlobalStore() is the exception for state that must survive a switch.
 */
export abstract class Store {
  private readonly listeners = new Set<Listener>();

  constructor() {
    workspaceStores.add(this);
  }

  /** Opts this store out of resetWorkspaceStores() — chainable at the export site for state that
   * must survive a switch (agent/workspace/branch/PR stores, codeViewMode/panel-open chrome). */
  markGlobalStore = (): this => {
    workspaceStores.delete(this);
    return this;
  };

  /** Reverts the store's state to its initial value — what resetWorkspaceStores() calls so one
   * worktree's expansion/diff/plan/selection never leaks onto another's canvas. Declared abstract
   * here because registration is now automatic: every store must say how to reset itself. */
  abstract reset(): void;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
