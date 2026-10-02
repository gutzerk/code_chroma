import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasElement } from "./types";
import type { EngineClient, SkillRunKind } from "../engine-client/EngineClient";
import { SidecarStore, useSidecarRecord, useSidecarSnapshot } from "./sidecarStore";
import { expansionStore } from "./expansionState";
import { revealNode, type NodeRefCache } from "./revealNode";
import { EMPTY_IMPACT_CHANGES } from "./types";
import type {
  ImpactBlockChange,
  ImpactChanges,
  C1Coverage,
  DiagramGenerationStatus,
  ImpactGhostBlock,
} from "./types";

const IDLE: DiagramGenerationStatus = { state: "idle", error: null };

/** A removed box presented as a box change, so one by-node lookup covers both kinds. It has no
 * files of its own -- the code is gone, and whatever deleted it is attributed to a live box. */
function ghostAsChange(ghost: ImpactGhostBlock): ImpactBlockChange {
  return {
    block: `${ghost.parent}/${ghost.id}`,
    node_id: ghost.node_id,
    name: ghost.name,
    path: null,
    status: "removed",
    files: [],
    change_count: 0,
    before: ghost.before,
    after: ghost.after,
    explanation: ghost.explanation,
    pr_comments: [],
  };
}

/** Global Impact change-review overlay, keyed per canvas node id -- `SidecarStore<T,S>`'s
 * `"changes"` instance (037 US2, replacing `c1ChangesStore`; moved to impact post-038). */
export const impactChangesSidecarStore = new SidecarStore<ImpactBlockChange, ImpactChanges>(
  EMPTY_IMPACT_CHANGES,
);

/** True when a box has something of its own to review (not just a rolled-up descendant count) --
 * a ghost's "removed" status counts even with empty prose, since it exists only because the review
 * named it. */
export function hasOwnChangeContent(change: ImpactBlockChange): boolean {
  return (
    change.files.length > 0 ||
    change.pr_comments.length > 0 ||
    Boolean(change.before || change.after || change.explanation) ||
    change.status === "removed"
  );
}

/** Folds `changes.ghosts` into the by-node map (via `ghostAsChange`) and publishes -- the one write
 * point every "changes" producer (the sync hook below, and tests) goes through. */
export function setChangesSnapshot(changes: ImpactChanges): void {
  impactChangesSidecarStore.setSnapshot(changes, [
    ...changes.blocks,
    ...changes.ghosts.map(ghostAsChange),
  ]);
}

export function useImpactChange(nodeId: string): ImpactBlockChange | undefined {
  return useSidecarRecord(impactChangesSidecarStore, nodeId);
}

export function useImpactChanges(): ImpactChanges {
  return useSidecarSnapshot(impactChangesSidecarStore);
}

/** A recipe-drawn element's key into any per-diagram sidecar -- keyed by the same
 * `recipe_key` string `canvas/recipes.py`'s `reshape`/`graph_to_ops` already stamps onto
 * `meta.recipe_key`, not the element's own uuid id. Shared by impact's changes overlay here, plus
 * `layerPositionCache.ts`/`diagramCatalog.ts` -- the key itself is generic, only which overlay/lookup
 * a caller uses it for differs. */
export function recipeChromeKey(element: CanvasElement): string {
  const key = element.meta.recipe_key;
  return typeof key === "string" ? key : "";
}

export interface NodeOverlays {
  isImpact: boolean;
  /** The "changes" overlay's record for this element, impact only. */
  change?: ImpactBlockChange;
}

/** One call replacing `CanvasNodeBox`'s old `isC1`/`isImpact` branch for the *changes* overlay --
 * reads whichever overlay this element's own render kind uses, via the same generic `SidecarStore`
 * every other overlay consumer (InspectorPanel, useNodeChrome) already reads directly by kind. */
export function useNodeOverlays(element: CanvasElement): NodeOverlays {
  const isImpact = element.render === "impact";
  const change = useImpactChange(isImpact ? recipeChromeKey(element) : "");
  return { isImpact, change };
}

/** Expands every changed/removed block's ancestor chain, the same reveal the diff toggle needs --
 * without it a changed block nested under a collapsed box never mounts, so its badge has nowhere to
 * render. A ghost is one level different: it's an extra *child*
 * of `parent_node_id` (the tree nests it there), so the parent itself must be expanded too, not just
 * the parent's ancestors. Impact boxes are real graph nodes (unlike C1's authored id trails), so this
 * shares the plain `revealNode` ancestor-fetch path -- one `NodeRefCache` per call, matching
 * `refreshDiffs`/`loadPlan`'s own batching, so siblings sharing an ancestor cost one fetch, not N. */
function revealChanges(changes: ImpactChanges, client: EngineClient): void {
  const cache: NodeRefCache = new Map();
  for (const block of changes.blocks) {
    void revealNode(block.node_id, client, cache).catch(() => {});
  }
  for (const ghost of changes.ghosts) {
    expansionStore.expand(ghost.parent_node_id);
    void revealNode(ghost.parent_node_id, client, cache).catch(() => {});
  }
}

/**
 * Drives the Impact change review while `enabled` -- see the original `useC1ChangeReview`'s own
 * long docstring (git history) for the full set of guarantees this preserves verbatim: badges
 * appear from a cheap deterministic fetch, never from an auto-triggered `claude -p` run;
 * `rereview()`/`stop()` are the only paths that start/cancel one; a stale review stays on screen
 * rather than auto-refreshing; `canGenerate: false` (the read-only PR case) keeps badges but makes
 * Re-review inert. Ported onto `impactChangesSidecarStore` (037 US2) in place of the old
 * `c1ChangesStore`, then retargeted from c1 to impact (038 follow-up).
 */
export function useImpactChangesSidecar(
  engineClient: EngineClient,
  enabled: boolean,
  canGenerate = true,
): DiagramGenerationStatus & {
  refresh: () => void;
  rereview: () => void;
  stop: () => void;
  loading: boolean;
} {
  const [status, setStatus] = useState<DiagramGenerationStatus>(IDLE);
  const [loading, setLoading] = useState(false);
  const serializedRef = useRef("");
  const statusRef = useRef(status);
  const engineClientRef = useRef(engineClient);
  engineClientRef.current = engineClient;

  const applyStatus = useCallback((next: DiagramGenerationStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const publish = useCallback(async (): Promise<boolean> => {
    const changes = await engineClientRef.current.getSidecar("changes");
    setLoading(false);
    const serialized = JSON.stringify(changes);
    if (serialized !== serializedRef.current) {
      serializedRef.current = serialized;
      setChangesSnapshot(changes);
      revealChanges(changes, engineClientRef.current);
    }
    return changes.has_review && !changes.stale;
  }, []);

  const refresh = useCallback(() => {
    void publish().catch(() => {});
  }, [publish]);

  const rereview = useCallback(() => {
    if (!canGenerate || statusRef.current.state === "generating") return;
    applyStatus({ state: "generating", error: null });
    void engineClientRef.current
      .generateDiagram("impact-changes" as SkillRunKind)
      .then(applyStatus)
      .catch((err) => {
        applyStatus({ state: "error", error: err instanceof Error ? err.message : String(err) });
      });
  }, [canGenerate, applyStatus]);

  const stop = useCallback(() => {
    void engineClientRef.current
      .cancelDiagram("impact-changes" as SkillRunKind)
      .then(applyStatus)
      .catch((err: unknown) => {
        applyStatus({ state: "error", error: err instanceof Error ? err.message : String(err) });
      });
  }, [applyStatus]);

  useEffect(() => {
    const forget = () => {
      impactChangesSidecarStore.clear();
      serializedRef.current = "";
    };

    if (!enabled) {
      forget();
      applyStatus(IDLE);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const sync = () => {
      void publish().catch(() => setLoading(false));
    };

    setLoading(true);
    sync();
    void engineClient.getDiagramStatus("impact-changes" as SkillRunKind).then((next) => {
      if (!cancelled) applyStatus(next);
    });
    const unsubscribeChanges = engineClient.subscribeSidecar("changes", sync);
    const unsubscribeStatus = engineClient.subscribeDiagramStatus(
      "impact-changes" as SkillRunKind,
      (next) => {
        if (cancelled) return;
        applyStatus(next);
      },
    );
    const unsubscribeChanged = engineClient.subscribe(sync);

    return () => {
      cancelled = true;
      unsubscribeChanges();
      unsubscribeStatus();
      unsubscribeChanged();
      forget();
    };
  }, [engineClient, enabled, publish, applyStatus]);

  return { ...status, refresh, rereview, stop, loading };
}

/**
 * How much of the repo the C1 diagram's named blocks account for, or null until the fetch answers.
 * Ported off `useC1Coverage` (037 US2) onto `getSidecar("coverage")` -- unchanged behavior (sequence
 * guard + serialized-dedupe, both load-bearing: the live bridge pings on every file save). Stays on
 * C1 -- coverage wasn't part of the review-axis move to impact.
 */
export function useCoverageSidecar(engineClient: EngineClient): C1Coverage | null {
  const [coverage, setCoverage] = useState<C1Coverage | null>(null);
  const serializedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let issued = 0;
    let newest = 0;
    function refetch() {
      const sequence = ++issued;
      engineClient
        .getSidecar("coverage")
        .then((next) => {
          if (cancelled || sequence <= newest) return;
          newest = sequence;
          const serialized = JSON.stringify(next);
          if (serialized === serializedRef.current) return;
          serializedRef.current = serialized;
          setCoverage(next);
        })
        .catch(() => {});
    }
    refetch();
    const unsubscribeDiagram = engineClient.subscribeDiagram("c1", refetch);
    const unsubscribeChanged = engineClient.subscribe(refetch);
    return () => {
      cancelled = true;
      unsubscribeDiagram();
      unsubscribeChanged();
    };
  }, [engineClient]);

  return coverage;
}
