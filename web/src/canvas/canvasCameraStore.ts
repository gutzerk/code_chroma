import { agentStore } from "../agents/agentStore";

/** The canvas camera (pan + zoom) persisted across reloads so a page refresh returns the user to the
 * place they left, not the reset origin. Box positions already persist (useSavedLayout -> canvas.json);
 * the camera's `view` lived only in CanvasViewport's local state, which is why a reload lost the
 * location. Mirrors the per-workspace namespace collapsedLayersStore uses, so one worktree's camera
 * never leaks onto another's. */
const STORAGE_PREFIX = "codechroma.cameraView";

/** The storage key for the currently active workspace -- read on demand so the store never needs
 * rebinding when the workspace switches (agentStore is global, non-reset state). */
function storageKey(): string {
  return `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;
}

/** Parses the persisted camera view for the active workspace, or null when the key is absent/corrupt
 * or holds the reset origin. Never throws: localStorage can be unavailable (private mode), and scale
 * is divided by at render time so a non-numeric value would poison the transform. */
export function readSavedCameraView(): { x: number; y: number; scale: number } | null {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown; scale?: unknown };
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.scale !== "number"
    ) {
      return null;
    }
    const view = { x: parsed.x, y: parsed.y, scale: parsed.scale };
    // A reset origin isn't a meaningful place to return to -- callers skip the restore (and fall
    // back to the default fit) when this returns null.
    return view.x === 0 && view.y === 0 && view.scale === 1 ? null : view;
  } catch {
    return null;
  }
}

/** Persists the current camera view for the active workspace. Non-fatal on write failure. */
export function writeSavedCameraView(view: { x: number; y: number; scale: number }): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(view));
  } catch {
    /* best effort -- a failed write only loses the restore, never crashes pan/zoom */
  }
}

/** Drops the persisted view for the active workspace — used by tests so each fresh CanvasViewport
 * starts from the reset origin instead of restoring whatever the previous test panned/zoomed to. */
export function clearSavedCameraView(): void {
  try {
    window.localStorage.removeItem(storageKey());
  } catch {
    /* best effort -- tests; a failed removal only leaves a stale restore the next mount reads */
  }
}
