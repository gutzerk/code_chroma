import { useSyncExternalStore } from "react";
import type { PrWorkspace } from "../state/types";
import { Store } from "../state/createStore";

const EMPTY: PrWorkspace[] = [];

/** The open pull-request reviews, in-memory and re-read from GET /prs on mount.
 *
 * Also the client-side half of the read-only signal: `has(id)` is OR'd into
 * workspaceStore.getIsReadOnly, so a bridge that forgets `read_only` on a PR's status still can't
 * offer an Accept button. */
class PrStore extends Store {
  private prs: PrWorkspace[] = EMPTY;
  private ids = new Set<string>();

  getAll = (): PrWorkspace[] => this.prs;

  has = (id: string): boolean => this.ids.has(id);

  setList = (prs: PrWorkspace[]): void => {
    this.prs = prs;
    this.ids = new Set(prs.map((pr) => pr.id));
    this.emit();
  };

  upsert = (pr: PrWorkspace): void => {
    const without = this.prs.filter((candidate) => candidate.number !== pr.number);
    this.setList([...without, pr].sort((a, b) => b.number - a.number));
  };

  remove = (id: string): void => {
    this.setList(this.prs.filter((pr) => pr.id !== id));
  };

  reset = (): void => {
    this.setList(EMPTY);
  };
}

export const prStore = new PrStore().markGlobalStore();

export function usePrWorkspaces(): PrWorkspace[] {
  return useSyncExternalStore(prStore.subscribe, prStore.getAll);
}
