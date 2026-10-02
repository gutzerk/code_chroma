import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../state/types";
import { changeCardStore } from "../state/changeCardStore";
import { diffOverlayStore } from "../state/diffOverlayStore";
import { expansionStore } from "../state/expansionState";
import { hierarchyChangesStore } from "../state/hierarchyChangesStore";
import { liveStore } from "../state/liveStore";
import { refreshDiffs, scheduleRefreshDiffs } from "../state/refreshDiffs";
import type { CanvasCamera } from "./useCanvasCamera";

interface DiffToggleOptions {
  engineClient: EngineClient;
  rootNode: HierarchyNodeRef | null;
  camera: CanvasCamera;
  /** The shared live-ping counter; the reconciler below re-fetches off it. */
  liveVersion: number;
  isDiffActive: boolean;
}

export interface DiffToggle {
  toggle: () => Promise<void>;
  /** True from the click that turns diff mode ON until refreshDiffs()'s fetch/reveal chain settles
   * (success, failure or cancellation) — `isDiffActive` itself can't serve as that signal, since it
   * only flips once that whole chain is done (diffOverlayStore.setDiffs() is its very last step).
   * Without this, a PR with many changed files leaves the button looking unpressed and inert for
   * however long that takes, with nothing on screen to say a click landed at all. Turning diff mode
   * off is local/sync, so it never sets this.
   *
   * ⚠ The button must NOT be `disabled` while this is true: a click during activation is the cancel
   * gesture (see toggle()). Every request is now bounded by EngineClient's REQUEST_TIMEOUT_MS, so a
   * hung fetch can no longer strand this flag on its own — but taking the control away mid-load
   * would still leave the user watching a spinner they didn't ask to keep. */
  isPending: boolean;
}

/** Diff mode's lifecycle over the plain hierarchy view: toggle, pre-diff snapshot, live reconciler. */
export function useDiffToggle({
  engineClient,
  rootNode,
  camera,
  liveVersion,
  isDiffActive,
}: DiffToggleOptions): DiffToggle {
  // Pre-diff snapshot of what was expanded / code-visible, captured on the first click so the
  // second can undo exactly what the reveal added (and nothing the user opened meanwhile).
  const preDiffSnapshotRef = useRef<{ expanded: Set<string>; code: Set<string> } | null>(null);
  // Last live version the reconciler processed, so activating diff (no version change) doesn't
  // re-run the live refresh and fight the toggle's own camera framing.
  const lastLiveVersionRef = useRef(0);

  // While diff mode is on, re-fetch on each live change and reveal any newly-changed function's
  // window (reveal/showCode are idempotent, so already-open windows aren't moved or reopened —
  // setDiffs just refreshes their content in place). No camera framing here on purpose.
  //
  // 🔴 Through the scheduler, never a bare refreshDiffs with a `cancelled` flag: this effect's
  // cleanup runs on every liveVersion bump, so cancelling meant a run that outlived one ping never
  // published, and under a ping stream the diff layer never landed at all.
  useEffect(() => {
    if (!isDiffActive || liveVersion === lastLiveVersionRef.current) return;
    lastLiveVersionRef.current = liveVersion;
    scheduleRefreshDiffs(engineClient);
  }, [liveVersion, isDiffActive, engineClient]);

  const [isPending, setIsPending] = useState(false);
  // The activation in flight, or null. One AbortController IS the whole cancel mechanism: aborting
  // it stops refreshDiffs' fetches outright and makes it resolve to null instead of publishing.
  const activationRef = useRef<AbortController | null>(null);

  /** Undoes exactly what the reveal added, and drops the snapshot. Shared by the two ways diff mode
   * can end — the second click, and a cancelled activation — because a reveal that got partway
   * through expands real blocks either way. 🔴 Without this on the cancel path those expansions
   * survived, and the *next* activation then snapshotted the polluted state as its own baseline, so
   * they could never be undone at all. */
  const restorePreDiffSnapshot = useCallback((): void => {
    const snapshot = preDiffSnapshotRef.current;
    preDiffSnapshotRef.current = null;
    if (!snapshot) return;
    // Hide code first, then collapse — collapse cascades to descendants, so undoing code
    // visibility beforehand keeps the two deltas independent of ordering.
    for (const id of expansionStore.getCodeVisibleNodeIdsByOrder()) {
      if (!snapshot.code.has(id)) expansionStore.hideCode(id);
    }
    for (const id of [...expansionStore.getExpandedNodeIdsByOrder()]) {
      if (!snapshot.expanded.has(id)) expansionStore.collapse(id);
    }
  }, []);

  // Cancels whatever activation is in flight; returns whether there was one, which is what tells a
  // cancel click apart from an ordinary toggle click.
  const cancelActivation = useCallback((): boolean => {
    const controller = activationRef.current;
    if (controller === null) return false;
    activationRef.current = null;
    // Abort before restoring: revealNode re-checks the signal before it expands, so no walk that
    // was already in flight can re-expand a block this restore has just collapsed.
    controller.abort();
    restorePreDiffSnapshot();
    setIsPending(false);
    camera.release();
    return true;
  }, [camera, restorePreDiffSnapshot]);

  const toggle = useCallback(async () => {
    // A click while the spinner is up is the cancel gesture, and it puts back whatever the
    // half-finished reveal had already expanded.
    if (cancelActivation()) return;

    if (diffOverlayStore.getIsActive()) {
      camera.suppress();
      restorePreDiffSnapshot();
      diffOverlayStore.clear();
      // The snapshot restore already collapsed what the card reveal expanded: cards only ever
      // expand ancestors, never show code, so both layers undo through the same two deltas.
      changeCardStore.clear();
      hierarchyChangesStore.clear();
      if (rootNode) camera.fitToNode(rootNode.node_id);
      camera.release();
      return;
    }

    const activation = new AbortController();
    activationRef.current = activation;
    camera.suppress();
    setIsPending(true);
    try {
      preDiffSnapshotRef.current = {
        expanded: new Set(expansionStore.getExpandedNodeIdsByOrder()),
        code: new Set(expansionStore.getCodeVisibleNodeIdsByOrder()),
      };
      // getDiff's own git_sync may have just discovered a brand-new file/class — force every
      // expanded parent to re-fetch its children (exactly like a live ping) so the new block mounts
      // and the reveal below has something to render. Mark the version handled so the reconciler
      // above doesn't redundantly re-run getDiff off this same bump.
      liveStore.bump();
      lastLiveVersionRef.current = liveStore.getVersion();
      // Same fetch-reveal-publish that every live update and Accept click runs, rather than a
      // second copy of it here: it reveals concurrently and skips deleted entries, with no live
      // block.
      const result = await refreshDiffs(engineClient, activation.signal);
      // A cancelled run published nothing, so there is no changed set to frame and the camera was
      // already released by whoever cancelled it.
      if (activation.signal.aborted) return;
      const framed = new Set([
        ...(result?.diffs ?? []).map((entry) => entry.node_id),
        ...(result?.cards ?? []).map((card) => card.node_id),
      ]);
      camera.frameFitTo([...framed]);
    } catch (err) {
      // Without this the rejection is swallowed by `void toggleDiff()` at the call site and
      // camera.isSuppressed() stays true for the rest of the session — surface it and release.
      console.error("[diff] toggleDiff failed", err);
      camera.release();
    } finally {
      // Only if this is still the current activation: a newer click already owns the button.
      if (activationRef.current === activation) {
        activationRef.current = null;
        setIsPending(false);
      }
    }
  }, [engineClient, rootNode, camera, cancelActivation, restorePreDiffSnapshot]);

  return { toggle, isPending };
}
