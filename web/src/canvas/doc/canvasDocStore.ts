import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../state/types";

const NO_CARRIERS: CanvasElement[] = [];

/** Pulls the `render: "route"` carriers out of a doc, returning the same doc object when it has none. */
function splitRouteCarriers(doc: CanvasDoc): { rest: CanvasDoc; carriers: CanvasElement[] } {
  const carriers: CanvasElement[] = [];
  const elements: CanvasDoc["elements"] = {};
  for (const [id, element] of Object.entries(doc.elements)) {
    if (element.render === "route") carriers.push(element);
    else elements[id] = element;
  }
  return carriers.length === 0 ? { rest: doc, carriers: NO_CARRIERS } : { rest: { ...doc, elements }, carriers };
}

/** Keeps the previous array when the carriers are unchanged, so route subscribers skip a re-render. */
function stableCarriers(previous: CanvasElement[], next: CanvasElement[]): CanvasElement[] {
  if (previous.length !== next.length) return next;
  if (next.length === 0) return previous;
  const same = next.every((carrier, i) => {
    const before = previous[i];
    return carrier.id === before.id && carrier.layer === before.layer && JSON.stringify(carrier.meta) === JSON.stringify(before.meta);
  });
  return same ? previous : next;
}

/** The one canvas document in memory, plus the one optimistic edit a drag needs (016-single-canvas-
 * dashboard, Stage 2). Follows state/createStore.ts like every other canvas store; workspace-scoped
 * so switching repos/agents never leaks one worktree's boxes onto another's. */
class CanvasDocStore extends Store {
  private _doc: CanvasDoc = EMPTY_CANVAS_DOC;
  private _loaded = false;
  // 026: the undrawn route-carrier elements, split out of `_doc` so no layout/bounds/selection code sees them.
  private _routeCarriers: CanvasElement[] = NO_CARRIERS;
  // Diagram layers mid auto-layout (runRecipeAndLayout): a server snapshot whose elements for one of
  // these layers are all still at (0,0) is the recipe's own transient commit, not a real move, so
  // fetchAndApplyCanvasDoc withholds it rather than flash the pile -- see its content check below.
  private _deferredLayers = new Set<string>();
  // Every getCanvas() call (a "changed" ping's refetch, patchCanvasDoc's own post-write refetch)
  // bumps this so whichever response is genuinely the newest always wins -- see
  // fetchAndApplyCanvasDoc's own comment. Lives on the store, not a module-level `let`, so the
  // guard stays correct if a second CanvasDocStore instance is ever mounted alongside this one.
  private _latestFetchSeq = 0;
  // Layers whose auto-layout failed once; skipped afterwards so a persistent failure can't loop.
  // Per store (cleared by reset) so one workspace's failure never disables layout in another.
  readonly unlayoutableLayers = new Set<string>();
  // Ids the auto-layout already placed, so a box that lands back on the origin isn't re-placed.
  readonly autoPlacedIds = new Set<string>();

  nextFetchSeq = (): number => ++this._latestFetchSeq;
  isLatestFetchSeq = (seq: number): boolean => seq === this._latestFetchSeq;

  getDoc = (): CanvasDoc => this._doc;
  isLoaded = (): boolean => this._loaded;
  getRouteCarriers = (): CanvasElement[] => this._routeCarriers;

  deferLayout(layer: string): void {
    this._deferredLayers.add(layer);
  }

  /** The layers whose auto-layout is still in flight (runRecipeAndLayout hasn't released them). */
  layersMidLayout = (): string[] => [...this._deferredLayers];

  /** Releases just this layer once its layout is committed (runRecipeAndLayout's finally) — not the
   * whole set, so a concurrent layout for another layer stays withheld until it finishes too. */
  releaseLayout(layer: string): void {
    this._deferredLayers.delete(layer);
  }

  setDoc(doc: CanvasDoc): void {
    const { rest, carriers } = splitRouteCarriers(doc);
    this._routeCarriers = stableCarriers(this._routeCarriers, carriers);
    this._doc = rest;
    this._loaded = true;
    this.emit();
  }

  /** Merges a position straight into local state so a drag settles instantly instead of waiting on
   * a PATCH round trip; patchCanvasDoc's own refetch reconciles with the server right after. Every
   * other mutation (add/delete/label) isn't on an interaction's critical path yet, so it just waits
   * for that refetch. */
  moveElement(id: string, position: { x: number; y: number }): void {
    const element = this._doc.elements[id];
    if (!element) return;
    this._doc = {
      ...this._doc,
      elements: { ...this._doc.elements, [id]: { ...element, position } },
    };
    this.emit();
  }

  /** Same optimistic settle as `moveElement`, batched into one emit for a group drag's every
   * selected box -- looping `moveElement` would work too, but would re-render every canvas box once
   * per selected id instead of once total. */
  moveElements(positions: Record<string, { x: number; y: number }>): void {
    const elements = { ...this._doc.elements };
    let changed = false;
    for (const [id, position] of Object.entries(positions)) {
      const element = elements[id];
      if (!element) continue;
      elements[id] = { ...element, position };
      changed = true;
    }
    if (!changed) return;
    this._doc = { ...this._doc, elements };
    this.emit();
  }

  reset(): void {
    this._doc = EMPTY_CANVAS_DOC;
    this._routeCarriers = NO_CARRIERS;
    this._loaded = false;
    this.unlayoutableLayers.clear();
    this.autoPlacedIds.clear();
    this.emit();
  }
}

export const canvasDocStore = new CanvasDocStore();

export function useCanvasDoc(): CanvasDoc {
  return useSyncExternalStore(canvasDocStore.subscribe, canvasDocStore.getDoc);
}

/** The route carriers (026), one per diagram layer that authored a route. */
export function useRouteCarriers(): CanvasElement[] {
  return useSyncExternalStore(canvasDocStore.subscribe, canvasDocStore.getRouteCarriers);
}

export function useCanvasDocLoaded(): boolean {
  return useSyncExternalStore(canvasDocStore.subscribe, canvasDocStore.isLoaded);
}

/** Which layers have at least one element on the canvas doc -- the one "is this diagram present"
 * check, shared so the left panel's Diagrams tab, `DrawDiagramButton`'s readiness split, and any
 * single-layer gate (e.g. RootCanvas's C1 summary panel) read the same fact instead of each
 * re-deriving it from `doc.elements`. */
export function collectActiveLayers(doc: CanvasDoc): Set<string> {
  return new Set(Object.values(doc.elements).map((element) => element.layer));
}

/** The single-layer form of collectActiveLayers, as a subscription that yields a boolean rather than
 * the whole document. 🔴 A caller that only gates on one layer must use this: `useCanvasDoc()` hands
 * back a fresh object on every emit, so subscribing to it re-renders that component (and everything
 * under it) on every drag commit, every canvas PATCH and every live ping — while this bails out
 * unless the answer itself changed. */
export function useHasCanvasLayer(layer: string): boolean {
  return useSyncExternalStore(canvasDocStore.subscribe, () =>
    Object.values(canvasDocStore.getDoc().elements).some((element) => element.layer === layer),
  );
}
