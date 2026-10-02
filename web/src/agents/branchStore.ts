import { useSyncExternalStore } from "react";
import type { BranchInfo } from "../state/types";
import { Store } from "../state/createStore";

/** Main's current checked-out branch plus every branch it can switch to, for the branch switcher and
 * the filter that decides which agents' windows are visible right now (`branchScope.ts`).
 *
 * The last failed checkout lives here too, not in the switcher's own state: a switch is now also
 * started from the rail and from a notification click, and all three surface the same modal. */
class BranchStore extends Store {
  private current: string | null = null;
  private branches: string[] = [];
  private error: string | null = null;

  getCurrent = (): string | null => this.current;

  getBranches = (): string[] => this.branches;

  getError = (): string | null => this.error;

  setBranch = (info: BranchInfo): void => {
    this.current = info.current;
    this.branches = info.branches;
    this.error = null;
    this.emit();
  };

  setError = (message: string | null): void => {
    this.error = message;
    this.emit();
  };

  reset = (): void => {
    this.current = null;
    this.branches = [];
    this.error = null;
    this.emit();
  };
}

export const branchStore = new BranchStore().markGlobalStore();

export function useCurrentBranch(): string | null {
  return useSyncExternalStore(branchStore.subscribe, branchStore.getCurrent);
}

export function useBranches(): string[] {
  return useSyncExternalStore(branchStore.subscribe, branchStore.getBranches);
}

export function useBranchError(): string | null {
  return useSyncExternalStore(branchStore.subscribe, branchStore.getError);
}
