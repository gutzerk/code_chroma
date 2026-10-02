import { useSyncExternalStore } from "react";
import { Store } from "./createStore";
import type { DiagramDiagnostics } from "./types";

/** A stable empty snapshot, so `useSyncExternalStore` does not loop while nothing is reported. */
const NOTHING: Readonly<Record<string, DiagramDiagnostics>> = {};

/**
 * What each diagram layer on the canvas lost on its way in, keyed by layer name.
 *
 * Fed by `runRecipeAndLayout`'s response rather than a fetch: the recipe run is the exact moment
 * the user asked for the diagram, and it is the only place that sees BOTH drop layers (the
 * resolver's and `canvas/recipes.py`'s converters). No route, no polling.
 *
 * Workspace-scoped by construction (it extends `Store` and does not call `markGlobalStore`), so a
 * worktree switch cannot leave the previous repo's warning hanging over a different canvas.
 */
class DiagramHealthStore extends Store {
  private byLayer: Readonly<Record<string, DiagramDiagnostics>> = NOTHING;

  getAll = (): Readonly<Record<string, DiagramDiagnostics>> => this.byLayer;

  /** Records (or clears, when nothing was dropped) what one recipe run reported for `layer`. */
  set = (layer: string, diagnostics: DiagramDiagnostics | undefined): void => {
    const carriesSomething = diagnostics !== undefined && diagnostics.dropped_count > 0;
    if (!carriesSomething && this.byLayer[layer] === undefined) return;
    const next = { ...this.byLayer };
    if (carriesSomething) next[layer] = diagnostics;
    else delete next[layer];
    this.byLayer = next;
    this.emit();
  };

  /** Drops a layer's entry — the diagram was removed, so its warning no longer describes anything. */
  clear = (layer: string): void => {
    this.set(layer, undefined);
  };

  reset = (): void => {
    if (this.byLayer === NOTHING) return;
    this.byLayer = NOTHING;
    this.emit();
  };
}

export const diagramHealthStore = new DiagramHealthStore();

export function useDiagramHealth(): Readonly<Record<string, DiagramDiagnostics>> {
  return useSyncExternalStore(diagramHealthStore.subscribe, diagramHealthStore.getAll);
}
