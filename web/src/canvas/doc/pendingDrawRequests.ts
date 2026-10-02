/**
 * The set of diagram kinds the user pressed "Draw…" for and that are not on the canvas yet.
 *
 * `DrawDiagramButton` auto-adds a diagram the moment its artifact appears, but only for a kind in
 * this set — an unconditional auto-add would redraw the canvas any time any artifact changed for any
 * reason (a live reanalyze, another agent, a `git checkout`), which is not what the click asked for.
 *
 * Module-level rather than component state or a `Store`: `DrawDiagramButton` stays mounted for the
 * app's lifetime, and nothing renders off this set, so a subscribable store would buy nothing. Entries are
 * consumed exactly once, so a kind drawn, removed, and regenerated later does not re-add itself.
 */

const requested = new Set<string>();

/** Records that the user asked an agent to draw these kinds, so their arrival may auto-add them. */
export function markRequested(kinds: readonly string[]): void {
  for (const kind of kinds) requested.add(kind);
}

/** True once, if `kind` was requested; removes it so a later regeneration never re-adds silently. */
export function consume(kind: string): boolean {
  return requested.delete(kind);
}
