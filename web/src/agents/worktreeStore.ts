import { useSyncExternalStore } from "react";
import type { WorktreeRecord } from "../state/types";
import { Store } from "../state/createStore";

const NONE: WorktreeRecord[] = [];

function recordsEqual(a: WorktreeRecord[], b: WorktreeRecord[]): boolean {
  return (
    a.length === b.length &&
    a.every((left, index) => {
      const right = b[index];
      return (
        left.id === right.id &&
        left.name === right.name &&
        left.branch === right.branch &&
        left.worktree === right.worktree &&
        left.dirty === right.dirty &&
        left.worktree_lost === right.worktree_lost
      );
    })
  );
}

/** The worktree tabs of this project (GET /branches), the tab last chosen, and the strip's transient state. */
class WorktreeStore extends Store {
  private records: WorktreeRecord[] = NONE;
  private activeId: string | null = null;
  private creating = false;
  private warning: string | null = null;

  getRecords = (): WorktreeRecord[] => this.records;

  getActiveId = (): string | null => this.activeId;

  getCreating = (): boolean => this.creating;

  getWarning = (): string | null => this.warning;

  has = (id: string): boolean => this.records.some((record) => record.id === id);

  setList = (records: WorktreeRecord[], active: string | null): void => {
    const nextActive = active && records.some((record) => record.id === active) ? active : (records.at(-1)?.id ?? null);
    const same = recordsEqual(this.records, records);
    if (same && nextActive === this.activeId) return;
    if (!same) this.records = records;
    this.activeId = nextActive;
    this.emit();
  };

  setActive = (id: string): void => {
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit();
  };

  rename = (id: string, name: string): void => {
    this.records = this.records.map((record) => (record.id === id ? { ...record, name } : record));
    this.emit();
  };

  remove = (id: string): void => {
    this.records = this.records.filter((record) => record.id !== id);
    this.emit();
  };

  setCreating = (creating: boolean): void => {
    if (this.creating === creating) return;
    this.creating = creating;
    this.emit();
  };

  setWarning = (warning: string | null): void => {
    if (this.warning === warning) return;
    this.warning = warning;
    this.emit();
  };

  /** Starts a create in one emit: busy on, stale warning cleared. */
  beginCreate = (): void => {
    if (this.creating && this.warning === null) return;
    this.creating = true;
    this.warning = null;
    this.emit();
  };

  /** Lands a created tab and its fetch warning in one emit. */
  addCreated = (record: WorktreeRecord, warning: string | null): void => {
    this.records = [...this.records.filter((existing) => existing.id !== record.id), record];
    this.warning = warning;
    this.emit();
  };

  reset = (): void => {
    this.records = NONE;
    this.activeId = null;
    this.creating = false;
    this.warning = null;
    this.emit();
  };
}

export const worktreeStore = new WorktreeStore().markGlobalStore();

export function useWorktrees(): WorktreeRecord[] {
  return useSyncExternalStore(worktreeStore.subscribe, worktreeStore.getRecords);
}

export function useActiveWorktreeId(): string | null {
  return useSyncExternalStore(worktreeStore.subscribe, worktreeStore.getActiveId);
}

export function useWorktreeCreating(): boolean {
  return useSyncExternalStore(worktreeStore.subscribe, worktreeStore.getCreating);
}

export function useWorktreeWarning(): string | null {
  return useSyncExternalStore(worktreeStore.subscribe, worktreeStore.getWarning);
}
