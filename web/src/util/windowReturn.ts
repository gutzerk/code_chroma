/** How often a return to the window may trigger a resync; focus and visibilitychange fire as a pair. */
export const WINDOW_RETURN_MIN_INTERVAL_MS = 5_000;

/** Calls `onReturn` when the user comes back to the window (focus, or the page becoming visible), at most once per interval. */
export function onWindowReturn(
  onReturn: () => void,
  minIntervalMs = WINDOW_RETURN_MIN_INTERVAL_MS,
  now: () => number = Date.now,
): () => void {
  if (typeof window === "undefined") return () => {};
  let last = -Infinity;
  const handle = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const at = now();
    if (at - last < minIntervalMs) return;
    last = at;
    onReturn();
  };
  window.addEventListener("focus", handle);
  document.addEventListener("visibilitychange", handle);
  return () => {
    window.removeEventListener("focus", handle);
    document.removeEventListener("visibilitychange", handle);
  };
}
