import { VersionStore, useVersion } from "./versionStore";

/**
 * Global "block layout changed" signal. The overlay components (ConnectionsOverlay,
 * ChangeConnectionsOverlay) measure block boxes with getBoundingClientRect and must re-measure on any
 * block resize/move — not just expand/collapse. A single ResizeObserver + MutationObserver in
 * CanvasViewport bumps this counter (rAF-debounced), and the overlays read it as a recompute
 * trigger.
 */
export const canvasLayoutStore = new VersionStore();

export function useCanvasLayoutVersion(): number {
  return useVersion(canvasLayoutStore);
}
