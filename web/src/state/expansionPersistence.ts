import { agentStore } from "../agents/agentStore";

/** The snapshot of tree-expansion state that survives a reload: the expanded nodes and the nodes
 * with an open inline code view. Box *positions* already persist on canvas.json; this is purely the
 * "which blocks are open" half, so a page refresh restores the exact same viewport content (together
 * with the persisted camera, see canvasCameraStore) instead of auto-expanding a fresh tree and
 * sliding the user's view. Mirrors the per-workspace namespace collapsedLayersStore uses, so one
 * worktree's expansion never leaks onto another's. */
export interface ExpansionSnapshot {
  expanded: string[];
  codeVisible: string[];
}

const STORAGE_PREFIX = "codechroma.expansion";

/** The storage key for the currently active workspace -- read on demand so the module never needs
 * rebinding when the workspace switches (agentStore is global, non-reset state). */
function storageKey(): string {
  return `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;
}

/** Parses the persisted expansion snapshot for the active workspace, or null when the key is
 * absent/corrupt or holds no expanded nodes. Never throws: localStorage can be unavailable (private
 * mode). A snapshot with only codeVisible but nothing expanded is still valid (code can be open on a
 * collapsed block), so the non-null gate is "anything present that isn't the empty default". */
export function readExpansionSnapshot(): ExpansionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expanded?: unknown; codeVisible?: unknown };
    if (!Array.isArray(parsed.expanded) || !Array.isArray(parsed.codeVisible)) return null;
    const expanded = parsed.expanded.filter((x): x is string => typeof x === "string");
    const codeVisible = parsed.codeVisible.filter((x): x is string => typeof x === "string");
    if (expanded.length === 0 && codeVisible.length === 0) return null;
    return { expanded, codeVisible };
  } catch {
    return null;
  }
}

/** Persists the current expansion snapshot for the active workspace. Non-fatal on write failure. */
export function writeExpansionSnapshot(snapshot: ExpansionSnapshot): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(snapshot));
  } catch {
    /* best effort -- a failed write only loses the restore, never crashes expand/collapse */
  }
}

/** Drops the persisted snapshot for the active workspace -- used by tests and by reset() so a
 * workspace never restores a stale tree. */
export function clearExpansionSnapshot(): void {
  try {
    window.localStorage.removeItem(storageKey());
  } catch {
    /* best effort */
  }
}
