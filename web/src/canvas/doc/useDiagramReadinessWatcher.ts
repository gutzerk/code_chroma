import { useCallback, useEffect, useRef } from "react";
import { useActiveWorkspace } from "../../agents/agentStore";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { reportAsyncError, reportSkip } from "../../util/reportError";
import { onWindowReturn } from "../../util/windowReturn";
import type { DiagramsStatus } from "../../state/types";
import { canvasDocStore, collectActiveLayers, useCanvasDocLoaded } from "./canvasDocStore";
import { runRecipeAndLayout, WATCHED_DIAGRAM_EVENT_KINDS } from "./diagramCatalog";
import { diagramWatcherErrorStore } from "./diagramWatcherErrorStore";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";
import { isDiagramDismissed } from "./dismissedDiagrams";

/**
 * Watches per-kind diagram readiness and adds every ready kind that is not on the canvas -- plus
 * re-runs the recipe for a kind already on the canvas whose content fingerprint just changed (an
 * in-place edit of an already-drawn diagram). Mount exactly once (`RootCanvas`).
 *
 * The add is level-triggered, not edge-triggered: a diagram that exists on disk and is ready but not
 * placed should appear, whoever wrote it and whenever this watcher first saw it. 🔴 An edge ("just
 * became ready") rule left a diagram stranded for good once a status fetch recorded it as ready
 * without placing it -- there is no manual add. The left panel's delete removes the artifact too, so
 * it cannot come back; a canvas-only removal (`removeLayerAndRefresh`) is remembered in
 * `dismissedDiagrams` until the artifact's fingerprint changes. A fingerprint change on a diagram
 * already placed only updates content fields (never position/size, see recipes.py).
 */
export function useDiagramReadinessWatcher(): void {
  const engineClient = useEngineClient();
  const workspace = useActiveWorkspace();
  const docLoaded = useCanvasDocLoaded();
  // Seeded per workspace from sessionStorage rather than `null`: a plain in-memory ref resets on
  // every reload, so the first status fetch after a reload would skip the stale-fingerprint check.
  const lastStatusRef = useRef<{ workspace: string; status: DiagramsStatus | null }>({
    workspace,
    status: readCachedDiagramsStatus(workspace),
  });
  // Kinds whose recipe run is still in flight, so an overlapping refetch never draws them twice.
  const runningRef = useRef(new Set<string>());

  const refetchStatus = useCallback(async () => {
    // Until this workspace's doc is in, every placed layer would look missing and be redrawn; the docLoaded effect retries.
    const docIsIn = () => {
      if (canvasDocStore.isLoaded()) return true;
      reportSkip("diagram watcher", "canvas doc not loaded yet, will retry once it is");
      return false;
    };
    if (!docIsIn()) return;
    let next: DiagramsStatus;
    try {
      next = await engineClient.getDiagramsStatus();
    } catch (err) {
      // Keep the last known status rather than dropping to null; the next ping or window return retries.
      reportAsyncError("diagram status", err);
      return;
    }
    if (!docIsIn()) return;
    // Another workspace's status is no baseline for this one: compare against this one's own cache.
    if (lastStatusRef.current.workspace !== workspace) {
      lastStatusRef.current = { workspace, status: readCachedDiagramsStatus(workspace) };
    }
    const before = lastStatusRef.current.status;
    lastStatusRef.current = { workspace, status: next };
    writeCachedDiagramsStatus(next, workspace);
    const placed = collectActiveLayers(canvasDocStore.getDoc());
    const missing = Object.keys(next).filter((kind) => next[kind]?.ready && !placed.has(kind));
    const arrived = missing.filter(
      (kind) =>
        !runningRef.current.has(kind) &&
        !isDiagramDismissed(workspace, kind, next[kind]?.fingerprint ?? null),
    );
    for (const kind of missing.filter((kind) => !arrived.includes(kind))) {
      reportSkip("diagram watcher", `${kind} is ready but not placed: ${runningRef.current.has(kind) ? "still drawing" : "taken off the canvas"}`);
    }
    const stale = Object.keys(next).filter((kind) => {
      if (!placed.has(kind) || !next[kind]?.ready || runningRef.current.has(kind)) return false;
      const nextFp = next[kind]?.fingerprint;
      const beforeFp = before?.[kind]?.fingerprint;
      return nextFp != null && beforeFp != null && nextFp !== beforeFp;
    });
    let firstError: string | null = null;
    for (const kind of [...arrived, ...stale]) {
      runningRef.current.add(kind);
      const result = await runRecipeAndLayout(engineClient, kind)
        .catch((err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : "recipe run failed",
        }))
        .finally(() => runningRef.current.delete(kind));
      if (result.ok) continue;
      firstError ??= result.error;
      // Keep this kind's old baseline so the next ping sees it as still stale and retries.
      const baseline: DiagramsStatus = { ...(lastStatusRef.current.status ?? next) };
      const old = before?.[kind];
      if (old === undefined) delete baseline[kind];
      else baseline[kind] = old;
      lastStatusRef.current = { workspace, status: baseline };
      writeCachedDiagramsStatus(baseline, workspace);
    }
    diagramWatcherErrorStore.set(firstError);
  }, [engineClient, workspace]);

  // Runs again once the doc loads, since a fetch that landed first skipped the add.
  useEffect(() => {
    if (docLoaded) void refetchStatus();
  }, [docLoaded, refetchStatus]);

  // Coalesces a same-tick burst of pings (one batch write can touch several kinds at once) into a
  // single refetchStatus() call instead of one per kind.
  const refetchScheduledRef = useRef(false);
  const scheduleRefetch = useCallback(() => {
    if (refetchScheduledRef.current) return;
    refetchScheduledRef.current = true;
    queueMicrotask(() => {
      refetchScheduledRef.current = false;
      void refetchStatus();
    });
  }, [refetchStatus]);

  useEffect(() => {
    const unsubscribes = WATCHED_DIAGRAM_EVENT_KINDS.map((kind) =>
      engineClient.subscribeDiagram(kind, scheduleRefetch),
    );
    // A missed ping or a failed status fetch otherwise waits for the next ping; coming back to the window retries.
    unsubscribes.push(onWindowReturn(scheduleRefetch));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [engineClient, scheduleRefetch]);
}
