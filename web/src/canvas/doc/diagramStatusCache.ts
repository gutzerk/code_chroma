import type { DiagramsStatus } from "../../state/types";

const STORAGE_KEY = "codechroma.diagramsStatusCache";

/**
 * Survives a page reload within the same tab, so `DrawDiagramButton`'s stale-fingerprint check has a
 * real "before" to compare the freshly-fetched status against on the very first fetch after a reload.
 * Without this, every reload starts that in-memory baseline at `null`, which its check
 * treats as "nothing to compare yet" and skips -- so a diagram an agent edited before the reload
 * never gets flagged as stale until the user manually removes and re-adds it from the rail.
 */
export function readCachedDiagramsStatus(): DiagramsStatus | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DiagramsStatus) : null;
  } catch {
    return null;
  }
}

export function writeCachedDiagramsStatus(status: DiagramsStatus): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // sessionStorage can throw (quota, privacy mode); losing the cache just means the next reload
    // falls back to treating status as a fresh baseline, same as before this cache existed.
  }
}
