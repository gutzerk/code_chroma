import { collapsedLayersStore } from "./doc/collapsedLayersStore";
import { retryEachFrame } from "./retryFit";

// How many frames a diagram focus waits for a just-shown diagram's frame to mount and settle.
export const FOCUS_DIAGRAM_MAX_FRAMES = 30;

/** The layout sizes (transform-free) of every frame `fitToSelector` will union, or null while none is mounted. */
function frameSize(selector: string): string | null {
  const frames = [...document.querySelectorAll<HTMLElement>(selector)];
  return frames.length > 0 ? frames.map((frame) => `${frame.offsetWidth}x${frame.offsetHeight}`).join(",") : null;
}

/** Shows `layer` if hidden, then fits its frame once it mounts and holds one size for two frames, so measured box sizes are framed rather than authored ones. */
export function focusDiagramLayer(
  layer: string,
  fitToSelector: (selector: string) => boolean,
  isCancelled: () => boolean,
): void {
  collapsedLayersStore.expand(layer);
  const selector = `[data-diagram-layer="${CSS.escape(layer)}"]`;
  let lastSize: string | null = null;
  let fitted = false;
  retryEachFrame(
    () => {
      const size = frameSize(selector);
      const settled = size !== null && size === lastSize;
      lastSize = size;
      fitted = settled && fitToSelector(selector);
      return fitted;
    },
    FOCUS_DIAGRAM_MAX_FRAMES,
    isCancelled,
    // A frame still resizing at the cap is framed as it stands rather than not at all.
    () => {
      if (!fitted) fitToSelector(selector);
    },
  );
}
