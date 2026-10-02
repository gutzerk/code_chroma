import { useEffect, useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasBatchResult, type CanvasDoc, type CanvasOp } from "../../state/types";
import { reportAsyncError } from "../../util/reportError";
import { undoStore } from "../../state/undoStore";

/** The one canvas document in memory, plus the one optimistic edit a drag needs (016-single-canvas-
 * dashboard, Stage 2). Follows state/createStore.ts like every other canvas store; workspace-scoped
 * so switching repos/agents never leaks one worktree's boxes onto another's. */
class CanvasDocStore extends Store {
  private _doc: CanvasDoc = EMPTY_CANVAS_DOC;
  private _loaded = false;
  // Every getCanvas() call (a "changed" ping's refetch, patchCanvasDoc's own post-write refetch)
  // bumps this so whichever response is genuinely the newest always wins -- see
  // fetchAndApplyCanvasDoc's own comment. Lives on the store, not a module-level `let`, so the
  // guard stays correct if a second CanvasDocStore instance is ever mounted alongside this one.
  private _latestFetchSeq = 0;

  nextFetchSeq = (): number => ++this._latestFetchSeq;
  isLatestFetchSeq = (seq: number): boolean => seq === this._latestFetchSeq;

  getDoc = (): CanvasDoc => this._doc;
  isLoaded = (): boolean => this._loaded;

  setDoc(doc: CanvasDoc): void {
    this._doc = doc;
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
    let elements = this._doc.elements;
    for (const [id, position] of Object.entries(positions)) {
      const element = elements[id];
      if (!element) continue;
      elements = { ...elements, [id]: { ...element, position } };
    }
    if (elements === this._doc.elements) return;
    this._doc = { ...this._doc, elements };
    this.emit();
  }

  reset(): void {
    this._doc = EMPTY_CANVAS_DOC;
    this._loaded = false;
    this.emit();
  }
}

export const canvasDocStore = new CanvasDocStore();

export function useCanvasDoc(): CanvasDoc {
  return useSyncExternalStore(canvasDocStore.subscribe, canvasDocStore.getDoc);
}

export function useCanvasDocLoaded(): boolean {
  return useSyncExternalStore(canvasDocStore.subscribe, canvasDocStore.isLoaded);
}

/** Which layers have at least one element on the canvas doc -- the one "is this diagram present"
 * check, shared so `AgentRail`'s Diagrams tab, `DrawDiagramButton`'s readiness split, and any
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

/** Fetches the canvas doc and applies it only if no newer fetch has been issued since — see
 * `canvasDocStore`'s own `_latestFetchSeq` comment: a real network has no ordering guarantee
 * between requests, and a slower, now-stale response arriving AFTER a drag's own commit-refetch
 * used to silently overwrite the just-moved position with the pre-drag one, reading as the box
 * "jumping back" a moment after you dropped it. `isStale` additionally gates it on the caller's own
 * lifetime (e.g. an unmounted `useLoadCanvasDoc`, or a switched-away workspace), so a slow response
 * can't leak one workspace's boxes onto another's. Shared by every caller below so there's one
 * race-safe path into `canvasDocStore.setDoc`, not two independently-raceable ones. */
async function fetchAndApplyCanvasDoc(
  engineClient: EngineClient,
  isStale: () => boolean = () => false,
): Promise<void> {
  const seq = canvasDocStore.nextFetchSeq();
  const doc = await engineClient.getCanvas();
  if (canvasDocStore.isLatestFetchSeq(seq) && !isStale()) canvasDocStore.setDoc(doc);
}

/** Fetch + subscribe + dedupe for the canvas document, mirroring useDiagram's shape but pushing
 * into canvasDocStore instead of local component state, since every element/edge on the view reads
 * the same document. Every graph "changed" ping also refetches, since a pinned hierarchy element's
 * node_id can (un)resolve when the code it points at changes. */
export function useLoadCanvasDoc(engineClient: EngineClient): void {
  useEffect(() => {
    let cancelled = false;
    function refetch() {
      fetchAndApplyCanvasDoc(engineClient, () => cancelled).catch((cause: unknown) => {
        if (!cancelled) reportAsyncError("canvas doc fetch", cause);
      });
    }
    refetch();
    const unsubscribeCanvas = engineClient.subscribeCanvas(refetch);
    const unsubscribeChanged = engineClient.subscribe(refetch);
    return () => {
      cancelled = true;
      unsubscribeCanvas();
      unsubscribeChanged();
    };
  }, [engineClient]);
}

/** Applies one batch through PATCH /repos/{id}/canvas, then refetches on success so every consumer
 * sees the server's real ids — a drag's own position already settled optimistically via
 * moveElement, so this refetch is a no-op for that case visually. */
export async function patchCanvasDoc(
  engineClient: EngineClient,
  ops: CanvasOp[],
  options?: { layer?: string; explanation?: string; confirmMassDelete?: boolean },
): Promise<CanvasBatchResult> {
  const result = await engineClient.patchCanvas({
    ops,
    layer: options?.layer ?? "default",
    explanation: options?.explanation ?? "",
    confirm_mass_delete: options?.confirmMassDelete ?? false,
  });
  if (result.ok) await fetchAndApplyCanvasDoc(engineClient);
  return result;
}

/** Moves one or several canvas-doc elements to absolute positions: optimistic local settle first
 * (via `moveElements`), then a real `update_element` PATCH per id, rolled back to the pre-call
 * positions if the write fails -- the shared drag-commit body every CanvasNodeBox drag (solo or
 * group) and the "canvas" undo restore path both funnel through, so there's one write/rollback
 * shape for a canvas position change, not two. */
export function applyCanvasPositions(
  engineClient: EngineClient,
  positions: Record<string, { x: number; y: number }>,
): void {
  const doc = canvasDocStore.getDoc();
  const prior: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(positions)) {
    const el = doc.elements[id];
    if (el) prior[id] = el.position;
  }
  canvasDocStore.moveElements(positions);
  patchCanvasDoc(
    engineClient,
    Object.entries(positions).map(([id, position]) => ({
      op: "update_element" as const,
      id,
      position,
    })),
  )
    .then((result) => {
      if (!result.ok) canvasDocStore.moveElements(prior);
    })
    .catch((cause: unknown) => {
      canvasDocStore.moveElements(prior);
      reportAsyncError("canvas node drag", cause);
    });
}

/** The one commit path for a canvas-doc position change, solo or group: records the PRE-move
 * positions into `undoStore` under the `"canvas"` kind (only when something genuinely moved), then
 * applies + persists them via `applyCanvasPositions`. Shared by `CanvasNodeBox`'s own solo/group drag
 * and `DiagramFrame`'s whole-diagram drag, so there's exactly one place that decides what a "canvas"
 * undo entry looks like. */
export function commitCanvasPositions(
  engineClient: EngineClient,
  positions: Record<string, { x: number; y: number }>,
): void {
  const doc = canvasDocStore.getDoc();
  const prior: Record<string, { x: number; y: number }> = {};
  let changed = false;
  for (const [id, next] of Object.entries(positions)) {
    const el = doc.elements[id];
    if (!el) continue;
    prior[id] = el.position;
    if (el.position.x !== next.x || el.position.y !== next.y) changed = true;
  }
  if (changed) undoStore.recordCommit("canvas", prior);
  applyCanvasPositions(engineClient, positions);
}
