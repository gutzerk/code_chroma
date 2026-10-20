import { useCallback, useEffect, useRef } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { DiagramsStatus } from "../../state/types";
import { canvasDocStore, collectActiveLayers } from "./canvasDocStore";
import { runRecipeAndLayout, WATCHED_DIAGRAM_EVENT_KINDS } from "./diagramCatalog";
import { diagramWatcherErrorStore } from "./diagramWatcherErrorStore";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";

/**
 * Watches per-kind diagram readiness and auto-adds every kind that just became ready and is not yet
 * on the canvas -- plus re-runs the recipe for a kind already on the canvas whose content
 * fingerprint just changed (an in-place edit of an already-drawn diagram). Mount exactly once
 * (`RootCanvas`); `DrawDiagramButton` reads the status this writes to the session cache.
 *
 * The add is unconditional (no pending-request gate): a diagram that exists on disk and is ready
 * but not placed should appear, whoever wrote it -- the "Draw…" button, a terminal/agent-window
 * run, another agent on the same workspace. Ping scoping (`isForAnotherWorkspace`) and the
 * `!placed.has(kind)` check keep it from reacting to unrelated artifacts, and the `before === null`
 * guard means a first-ever visit adds nothing. A fingerprint change on a diagram already placed
 * needs no gate either -- it only updates content fields (never position/size, see recipes.py).
 */
export function useDiagramReadinessWatcher(): void {
  const engineClient = useEngineClient();
  // Seeded from sessionStorage rather than `null`: a plain in-memory ref resets on every reload, so
  // the first status fetch after a reload would skip the stale-fingerprint check below and an
  // agent's edit made before the reload would stay invisible.
  const lastStatusRef = useRef<DiagramsStatus | null>(readCachedDiagramsStatus());

  const refetchStatus = useCallback(async () => {
    let next: DiagramsStatus;
    try {
      next = await engineClient.getDiagramsStatus();
    } catch {
      // Keep the last known status rather than dropping to null — see computeReadyDiagrams' own note.
      return;
    }
    const before = lastStatusRef.current;
    lastStatusRef.current = next;
    writeCachedDiagramsStatus(next);
    // `before === null` only for a true first-ever visit (no cached status either): nothing
    // "became" ready or stale between having no baseline at all and this first answer.
    if (before === null) return;
    const placed = collectActiveLayers(canvasDocStore.getDoc());
    const arrived = Object.keys(next).filter(
      (kind) => next[kind]?.ready && !(before[kind]?.ready ?? false) && !placed.has(kind),
    );
    const stale = Object.keys(next).filter((kind) => {
      if (!placed.has(kind) || !next[kind]?.ready) return false;
      const nextFp = next[kind]?.fingerprint;
      const beforeFp = before[kind]?.fingerprint;
      return nextFp != null && beforeFp != null && nextFp !== beforeFp;
    });
    let firstError: string | null = null;
    for (const kind of [...arrived, ...stale]) {
      const result = await runRecipeAndLayout(engineClient, kind).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "recipe run failed",
      }));
      if (result.ok) continue;
      firstError ??= result.error;
      // Keep this kind's old baseline so the next ping sees it as still arrived/stale and retries.
      const baseline: DiagramsStatus = { ...(lastStatusRef.current ?? next) };
      const old = before[kind];
      if (old === undefined) delete baseline[kind];
      else baseline[kind] = old;
      lastStatusRef.current = baseline;
      writeCachedDiagramsStatus(baseline);
    }
    diagramWatcherErrorStore.set(firstError);
  }, [engineClient]);

  useEffect(() => {
    void refetchStatus();
  }, [refetchStatus]);

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
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [engineClient, scheduleRefetch]);
}
