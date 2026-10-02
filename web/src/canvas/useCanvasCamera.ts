import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { CanvasViewportHandle } from "./CanvasViewport";
import { retryFitLoop } from "./retryFit";

// ~3s at 60fps — long enough for a real HTTP bridge to lazily fetch each revealed ancestor's
// children, short enough that an id whose block never mounts can't retry-fit forever.
export const FIT_MAX_FRAMES = 180;

export interface CanvasCamera {
  /** Frames `ids`, retrying each frame until their blocks mount; releases suppression when done. */
  frameFitTo: (ids: string[], releaseSuppression?: boolean) => void;
  /** Takes the auto-fit lock, so the count-change effects leave the camera alone. */
  suppress: () => void;
  /** Releases it. */
  release: () => void;
  /** Whether the lock is held — read synchronously, so render timing can't race it. */
  isSuppressed: () => boolean;
  /** Fits one node immediately, the plain "put this back on screen" move. */
  fitToNode: (nodeId: string) => void;
}

/**
 * The canvas's camera policy, extracted from RootCanvas so it can be reasoned about (and tested)
 * on its own: the retry-until-mounted fit, and the suppression lock that stops the automatic
 * expand/collapse re-fits from fighting an explicit framing that is already in flight.
 *
 * Suppression is a ref rather than state on purpose — the effects that read it run at render time
 * and must see the current value, not the one captured when they were scheduled.
 */
export function useCanvasCamera(
  viewportRef: RefObject<CanvasViewportHandle | null>,
): CanvasCamera {
  const suppressedRef = useRef(false);
  // Bumped on every frameFitTo call so an older, still-running loop can tell it's been superseded
  // and stop re-scheduling itself — several independent triggers (view switch, auto-expand reveal,
  // diff/plan toggles) can each call frameFitTo on the same CanvasViewport within the retry window,
  // and without this an older loop's frame would keep calling fitToNodes with its own stale id set,
  // fighting the newer loop over CanvasViewport's shared fit-settle state every frame.
  const generationRef = useRef(0);

  const frameFitTo = useCallback(
    (ids: string[], releaseSuppression = true) => {
      const generation = ++generationRef.current;
      retryFitLoop(
        ids,
        (nodeIds) => viewportRef.current?.fitToNodes(nodeIds) ?? false,
        FIT_MAX_FRAMES,
        () => generationRef.current !== generation,
        () => {
          if (releaseSuppression) suppressedRef.current = false;
        },
      );
    },
    [viewportRef],
  );

  const suppress = useCallback(() => {
    suppressedRef.current = true;
  }, []);

  const release = useCallback(() => {
    suppressedRef.current = false;
  }, []);

  const isSuppressed = useCallback(() => suppressedRef.current, []);

  const fitToNode = useCallback(
    (nodeId: string) => {
      viewportRef.current?.fitToNode(nodeId);
    },
    [viewportRef],
  );

  // Memoized: every member is already stable, so the object must be too — an effect that depends
  // on `camera` would otherwise re-run on every render of the whole canvas.
  return useMemo(
    () => ({ frameFitTo, suppress, release, isSuppressed, fitToNode }),
    [frameFitTo, suppress, release, isSuppressed, fitToNode],
  );
}
