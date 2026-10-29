import { useEffect } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasBatchResult, CanvasOp } from "../../state/types";
import { reportAsyncError } from "../../util/reportError";
import { undoStore } from "../../state/undoStore";
import { canvasDocStore } from "./canvasDocStore";
import { findUnplaced, layoutUnplaced } from "./pileLayout";

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
  // A deferred layer's recipe commit broadcasts its boxes at (0,0) before the layout pass has run.
  // Withhold only that transient state -- a snapshot whose every element for a deferred layer is at
  // (0,0) -- so the pile never flashes, while any real move (a drag, an edit on another layer) still
  // applies. The layout PATCH that follows lands the laid-out positions and applies normally.
  const transientPile = [...canvasDocStore.layersMidLayout()].some((layer) => {
    const layouts = Object.values(doc.elements).filter((element) => element.layer === layer);
    return layouts.length > 0 && layouts.every((element) => element.position.x === 0 && element.position.y === 0);
  });
  if (transientPile) return;
  // Boxes that arrived on the origin (a position-less write nobody laid out) get the ELK pass here --
  // a whole piled layer from scratch, a few new boxes next to the placed ones -- so layout never
  // depends on which path drew the diagram.
  const skip = new Set([...canvasDocStore.unlayoutableLayers, ...canvasDocStore.layersMidLayout()]);
  const unplaced = Object.entries(findUnplaced(doc, skip, canvasDocStore.autoPlacedIds));
  if (unplaced.length > 0) {
    for (const [layer, ids] of unplaced) {
      canvasDocStore.deferLayout(layer);
      for (const id of ids) canvasDocStore.autoPlacedIds.add(id);
      layoutUnplaced(engineClient, doc, layer, ids)
        .then(() => true)
        .catch((cause: unknown) => {
          canvasDocStore.unlayoutableLayers.add(layer);
          reportAsyncError("canvas auto-layout", cause);
          if (canvasDocStore.isLatestFetchSeq(seq) && !isStale()) canvasDocStore.setDoc(doc);
          return false;
        })
        .then((laidOut) => {
          canvasDocStore.releaseLayout(layer);
          // The layout PATCH may have changed nothing (or its ping lost the race), so re-apply the
          // latest doc once the layer is released; the refetch takes its own newest seq.
          if (laidOut && !isStale()) {
            fetchAndApplyCanvasDoc(engineClient, isStale).catch((cause: unknown) =>
              reportAsyncError("canvas doc fetch", cause),
            );
          }
        });
    }
    return;
  }
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
