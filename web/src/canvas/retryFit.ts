/** The one bounded "retry fitToNodes across animation frames until layout settles" loop.
 *
 * useCanvasCamera.frameFitTo and useSavedLayoutAndFitLoop.useFrameFit used to each carry their own
 * copy of this idiom (their headers said so), differing only in cancellation style and cap. The
 * first attempt is deferred to a frame so the current render paints before the first measurement,
 * and `attempts` increments before the cap check so `maxFrames` is the true number of calls made —
 * both invariants each copy had to restate are now stated once.
 */
export function retryFitLoop(
  nodeIds: string[],
  fitToNodes: (nodeIds: string[]) => boolean,
  maxFrames: number,
  isCancelled: () => boolean,
  onDone?: () => void,
): void {
  retryEachFrame(() => fitToNodes(nodeIds) || nodeIds.length === 0, maxFrames, isCancelled, onDone);
}

/** Calls `attempt` once per animation frame until it returns true or `maxFrames` calls are made; the loop under `retryFitLoop`. */
export function retryEachFrame(
  attempt: () => boolean,
  maxFrames: number,
  isCancelled: () => boolean,
  onDone?: () => void,
): void {
  let attempts = 0;
  const step = () => {
    if (isCancelled()) return;
    attempts += 1;
    if (attempt() || attempts >= maxFrames) {
      onDone?.();
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
