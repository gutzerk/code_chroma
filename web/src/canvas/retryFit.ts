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
  let attempts = 0;
  const step = () => {
    if (isCancelled()) return;
    attempts += 1;
    const settled = fitToNodes(nodeIds);
    if (settled || nodeIds.length === 0 || attempts >= maxFrames) {
      onDone?.();
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
