import { useCallback, useEffect, useRef, useState } from "react";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { undoStore } from "../state/undoStore";
import type { LayoutKind } from "../state/types";
import type { Offset } from "./useDragOffset";
import { retryFitLoop } from "./retryFit";
import { UNDO_EVENT, type UndoEventDetail } from "./UndoManager";

// Frame-retry cap for the activation camera fit — shared default for every diagram view below.
// Distinct from useCanvasCamera's own FIT_MAX_FRAMES (180, sized for a slow real HTTP bridge fetch):
// two separate reimplementations of the same "retry fitTo* until settled" idiom, so the names must
// not collide, or tuning one's retry budget risks silently editing the other's constant instead.
const ACTIVATION_FIT_MAX_FRAMES = 60;

export interface SavedLayout {
  /** Positions saved in a prior session; null until that fetch resolves, so a consumer's boxes only
   * mount once each one can seed its initialOffset (read once on mount) from it. */
  savedOffsets: ReadonlyMap<string, Offset> | null;
  /** Live per-box drag displacement, keyed by box/node id — arrows and clusters are computed from
   * these so they stay attached wherever a box is dragged. Seeded from savedOffsets once resolved. */
  dragOffsets: ReadonlyMap<string, Offset>;
  handleOffsetChange: (id: string, offset: Offset) => void;
  handleCommit: (id: string, offset: Offset) => void;
  /** Same as handleCommit, batched — a group drag moves several boxes at once and must persist them
   * in one saveLayout call rather than racing N separate ones against each other. */
  handleCommitMany: (offsets: Record<string, Offset>) => void;
}

/** Fetches a layout kind's saved box layout once on mount and manages the live per-box drag offsets
 * on top of it, persisting once per finished drag (not on every pointer move). Only "hierarchy" has
 * a live backend route left as of 016-single-canvas-dashboard Stage 6 (every other kind's position
 * lives on canvas.json now, see single-canvas.md) -- kept kind-parametrized since `undoStore` shares
 * this shape across kinds regardless. */
export function useSavedLayout(kind: LayoutKind): SavedLayout {
  const engineClient = useEngineClient();
  const getLayout = useCallback(
    () => engineClient.getDiagramLayout(kind),
    [engineClient, kind],
  );
  const saveLayout = useCallback(
    (layout: Record<string, Offset>) => engineClient.saveDiagramLayout(kind, layout),
    [engineClient, kind],
  );
  const [dragOffsets, setDragOffsets] = useState<ReadonlyMap<string, Offset>>(new Map());
  const [savedOffsets, setSavedOffsets] = useState<ReadonlyMap<string, Offset> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLayout()
      .then((saved) => {
        if (cancelled) return;
        const restored = new Map(Object.entries(saved));
        setSavedOffsets(restored);
        setDragOffsets(restored);
      })
      .catch(() => {
        if (!cancelled) setSavedOffsets(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [getLayout]);

  // rAF-throttled, since both diagrams host DOM-measured badge/connector overlays that need to
  // re-measure while a box drags.
  const dragBumpFrameRef = useRef(0);
  // The layout as it stood at the START of the current drag gesture (captured on the first live
  // preview write, before it mutates dragOffsets). Group drags and solo drags both push their
  // in-flight positions into dragOffsets via the preview path before the commit fires, so by the
  // time commitMap runs `dragOffsetsRef.current` already holds the FINAL positions and compares
  // equal to the landing map — reading it as "previous" made every real drag's undo entry a no-op
  // (the undo tests passed only because they call handleCommit directly, bypassing the preview
  // writer). Snapshotting the true pre-gesture map here is what makes undo land boxes back where
  // they were before the drag.
  const gestureStartRef = useRef<ReadonlyMap<string, Offset> | null>(null);
  useEffect(() => () => cancelAnimationFrame(dragBumpFrameRef.current), []);
  const handleOffsetChange = useCallback((id: string, offset: Offset) => {
    setDragOffsets((previous) => {
      if (gestureStartRef.current === null) gestureStartRef.current = previous;
      const current = previous.get(id) ?? { x: 0, y: 0 };
      if (current.x === offset.x && current.y === offset.y) return previous;
      cancelAnimationFrame(dragBumpFrameRef.current);
      dragBumpFrameRef.current = requestAnimationFrame(() => canvasLayoutStore.bump());
      return new Map(previous).set(id, offset);
    });
  }, []);

  // A ref holds the latest offsets so the handler stays stable yet always saves the full, current
  // map.
  const dragOffsetsRef = useRef(dragOffsets);
  dragOffsetsRef.current = dragOffsets;
  // Applies a new layout to both live offsets and persistence, WITHOUT recording it into the undo
  // history — the restore path for an undo. A finished drag must never call this (it would both
  // record a no-op inverse entry and clear the undo stack it just popped from).
  const applyMap = useCallback(
    (next: ReadonlyMap<string, Offset>) => {
      setDragOffsets(next);
      void saveLayout(Object.fromEntries(next)).catch(() => {});
    },
    [saveLayout],
  );
  // A single drag-end writer shared by the one-box and multi-box commits: both merge into the live
  // offsets and persist the whole map. It is also the single chokepoint every diagram-kind's
  // finished drag routes through, so it records each commit into the shared undo history here —
  // one place covers c1, patterns, epics and hierarchy alike.
  const commitMap = useCallback(
    (next: ReadonlyMap<string, Offset>) => {
      // The undo baseline is what the gesture STARTED from (gestureStartRef, captured on the first
      // preview write), not dragOffsetsRef.current — the preview path has already overwritten that
      // with the landing positions by commit time, so using it would record a no-op entry (or, for
      // boxes the gesture left untouched, a wrongly-narrow snapshot). Fall back to the live map only
      // for a commit that had no preview write (a programmatic/one-shot commit).
      const baseline = gestureStartRef.current ?? dragOffsetsRef.current;
      const changed =
        baseline.size !== next.size ||
        [...next].some(([id, offset]) => {
          const before = baseline.get(id);
          return !before || before.x !== offset.x || before.y !== offset.y;
        });
      // Record the PRE-commit layout (what undoing this drag must restore), then apply.
      if (changed) undoStore.recordCommit(kind, Object.fromEntries(baseline));
      gestureStartRef.current = null;
      applyMap(next);
    },
    [kind, applyMap],
  );

  const handleCommit = useCallback(
    (id: string, offset: Offset) => {
      commitMap(new Map(dragOffsetsRef.current).set(id, offset));
    },
    [commitMap],
  );

  const handleCommitMany = useCallback(
    (offsets: Record<string, Offset>) => {
      const next = new Map(dragOffsetsRef.current);
      for (const [id, offset] of Object.entries(offsets)) next.set(id, offset);
      commitMap(next);
    },
    [commitMap],
  );

  // Undo is dispatched as a window-level event (see UndoManager.tsx) so every diagram-kind shares
  // one handler but only the view whose kind matches the undone snapshot reacts. Restoring goes
  // through applyMap (the same persist+writes path a finished drag uses, minus the history write)
  // so the undo both updates dragOffsets (boxes re-render at their prior spot) and re-persists the
  // restored layout.
  useEffect(() => {
    const onUndo = (event: Event) => {
      const snapshot = (event as CustomEvent<UndoEventDetail>).detail;
      if (snapshot.kind !== kind) return;
      applyMap(new Map(Object.entries(snapshot.layout)));
    };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [kind, applyMap]);

  return { savedOffsets, dragOffsets, handleOffsetChange, handleCommit, handleCommitMany };
}

/** Frames the diagram via the shared retryFitLoop (see retryFit.ts for the loop's invariants),
 * re-armed whenever `fitKey` changes — activation, generation completing, or a live edit changing
 * the box set. A falsy `fitKey` (PatternsView's "boxes aren't mounted yet" case) is a no-op rather
 * than burning retries on ids nothing renders. */
export function useFrameFit(
  fitKey: string,
  fitToNodes: ((nodeIds: string[]) => boolean) | undefined,
  maxFrames: number = ACTIVATION_FIT_MAX_FRAMES,
): void {
  useEffect(() => {
    if (!fitToNodes || !fitKey) return;
    let cancelled = false;
    retryFitLoop(fitKey.split(","), fitToNodes, maxFrames, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fitKey, fitToNodes, maxFrames]);
}
