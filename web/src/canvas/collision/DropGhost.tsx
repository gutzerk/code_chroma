import { createPortal } from "react-dom";
import type { DropGhostGeometry } from "./useCollisionAvoidance";

/**
 * The outline of where the dragged block will land, shown while the button is still held down — what
 * turns "the block jumped somewhere after I let go" into "I saw where it was going".
 *
 * Portalled into `.canvas-content` rather than rendered inside the block: it has to sit in the boxes'
 * own coordinate space to track pan and zoom, and the floating panels clip their overflow, which
 * would swallow an outline drawn as their child. Being absolutely positioned it contributes nothing
 * to its container's intrinsic width, so it can't reintroduce the shrink-to-fit overflow that
 * `.c1-node-anchor { width: max-content }` exists to prevent.
 */
export function DropGhost({ ghost }: { ghost: DropGhostGeometry | null }) {
  if (!ghost) return null;
  return createPortal(
    <div
      className={`drop-ghost${ghost.blocked ? " drop-ghost--blocked" : ""}`}
      data-testid="drop-ghost"
      data-blocked={ghost.blocked}
      aria-hidden="true"
      style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}
    />,
    ghost.container,
  );
}
