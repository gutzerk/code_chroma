// Logical spacing of the whiteboard dot grid, in .canvas-content coordinates.
const GRID_BASE = 28;

/** The painted dot spacing at a given zoom, kept legible by doubling/halving the logical step so it
 * always lands within [GRID_BASE, 2*GRID_BASE): a flat GRID_BASE * scale would turn to grey mush at
 * the 0.25x floor and thin out to a few lonely dots at the 2.5x ceiling. The dot at the content origin
 * stays put whatever step is chosen, since CanvasViewport phases the grid by the pan offset — so a
 * step change while zooming is invisible rather than a jump. */
export function gridStep(scale: number): number {
  let step = GRID_BASE * scale;
  if (!Number.isFinite(step) || step <= 0) return GRID_BASE;
  while (step < GRID_BASE) step *= 2;
  while (step >= GRID_BASE * 2) step /= 2;
  return step;
}
