import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attachAgent } from "../../agents/attachAgent";
import { useAgentClient } from "../../agents/AgentClientContext";
import { useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../agents/agentStore";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { DiagramsStatus } from "../../state/types";
import { RailIcon } from "../../icons/RailIcon";
import { RailButton } from "../RailButton";
import { canvasDocStore, collectActiveLayers, useCanvasDoc } from "./canvasDocStore";
import {
  computeReadyDiagrams,
  runRecipeAndLayout,
  useCustomDiagramTypes,
  WATCHED_DIAGRAM_EVENT_KINDS,
} from "./diagramCatalog";
import { consume, markRequested } from "./pendingDrawRequests";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";

/** Builds the agent's actionable first message for "Draw…" -- naming only what's still missing, so
 * an agent opened after some diagrams already exist doesn't re-offer those. When nothing is missing
 * (every built-in and saved type is already drawn), there's nothing to enumerate -- the agent is
 * told to just ask what new diagram the user wants instead.
 *
 * `missingLabels` has no upper bound (every missing built-in plus every missing custom type), but
 * a multiple-choice tool call caps out at 4 options -- asking the agent to offer more than that as
 * a single such call fails with a schema-validation error the user just sees as "Invalid tool
 * parameters", with no diagram drawn and the agent stuck. Past 4, the prompt tells it to ask in
 * plain text instead, so the option count never collides with that cap. */
export function buildDrawDiagramTask(missingLabels: string[], anyAlreadyReady: boolean): string {
  const article = anyAlreadyReady ? "another" : "a";
  if (missingLabels.length === 0) {
    return (
      `The user wants ${article} diagram of this project. Every built-in and saved diagram type is ` +
      "already drawn -- ask what new diagram they'd like (redrawing something existing, or a fresh " +
      "one-off custom diagram), then use the codechroma-draw-diagram skill to draw it."
    );
  }
  const askHint =
    missingLabels.length > 4
      ? " (more than 4 -- list them in your reply as plain text, not a multiple-choice tool call)"
      : "";
  return (
    `The user wants ${article} diagram of this project. Ask which kind they'd like${askHint} -- ` +
    `${missingLabels.join(", ")} -- then use the codechroma-draw-diagram skill and pick the ` +
    `matching type from its router table to draw it.`
  );
}

/**
 * The rail's "Draw…" button (016-single-canvas-dashboard Stage 4, shrunk in the diagram-management
 * unification that retired `RecipeMenu`'s dropdown and the custom-diagram-type wizard): a single
 * action, always clickable, that opens an agent already asking what to draw
 * (`codechroma-draw-diagram`). It does not list or toggle diagrams anymore -- every diagram that
 * exists, ready or already placed, is shown and managed from `AgentRail`'s Diagrams tab instead;
 * this button's only job is starting a new draw.
 *
 * Still tracks readiness in the background, for two reasons that have nothing to do with any menu:
 * it needs `missingLabels`/`missingKinds` to word the agent's task prompt (`buildDrawDiagramTask`),
 * and it drives the auto-add-when-ready effect below (`pendingDrawRequests`) that places a diagram
 * on the canvas the moment the agent it launched finishes drawing it.
 */
export function DrawDiagramButton() {
  const engineClient = useEngineClient();
  const agentClient = useAgentClient();
  const isLaunchingAgent = useIsLaunchingAgent();
  const isAtAgentCapacity = useIsAtAgentCapacity();
  const maxAgents = useMaxAgents();
  const doc = useCanvasDoc();
  const activeLayers = useMemo(() => collectActiveLayers(doc), [doc]);
  const customTypes = useCustomDiagramTypes(engineClient);
  const [status, setStatus] = useState<DiagramsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The previous readiness map, so a refetch can tell "already there" from "just arrived". A ref,
  // not state: only the auto-add below reads it, and it must see the value the last fetch wrote.
  // Seeded from sessionStorage rather than `null`: a plain in-memory ref resets on every reload, so
  // the very first status fetch after a reload always looked like "nothing to compare yet" and
  // skipped the stale-fingerprint check below -- an agent's edit made before the reload then stayed
  // invisible until the user manually removed and re-added the diagram from the rail.
  const lastStatusRef = useRef<DiagramsStatus | null>(readCachedDiagramsStatus());

  /**
   * Refetches the per-kind readiness map, then auto-adds every kind that just became ready AND was
   * asked for through "Draw…" -- plus re-runs the recipe for a kind already on the canvas whose
   * content fingerprint just changed (an in-place edit of an already-drawn diagram). The one place
   * status is fetched, shared by the mount effect and the per-kind watcher subscriptions.
   *
   * The pending-request gate applies only to a brand-new draw: without it, any artifact change (a
   * live reanalyze, an unrelated agent, a branch switch) would silently add a diagram nobody asked
   * for. A fingerprint change on a diagram already placed needs no such gate -- it can only ever
   * update content fields (never position/size, see recipes.py), so refreshing it is never a
   * surprise, just the picture catching up with what is already on disk.
   */
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
    setStatus(next);
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
    const runAndReport = async (kind: string) => {
      const result = await runRecipeAndLayout(engineClient, kind).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "recipe run failed",
      }));
      if (!result.ok) setError(result.error);
    };
    for (const kind of arrived) {
      if (!consume(kind)) continue;
      await runAndReport(kind);
    }
    for (const kind of stale) {
      await runAndReport(kind);
    }
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
    // Custom-type arrivals are covered by `useCustomDiagramTypes`'s own subscription above; this
    // loop only needs to drive the status refetch.
    const unsubscribes = WATCHED_DIAGRAM_EVENT_KINDS.map((kind) =>
      engineClient.subscribeDiagram(kind, scheduleRefetch),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [engineClient, scheduleRefetch]);

  const { missingLabels, missingKinds, anyGeneratedReady } = useMemo(
    () => computeReadyDiagrams(status, customTypes, activeLayers),
    [status, customTypes, activeLayers],
  );

  const onDrawDiagram = () => {
    setError(null);
    // Marked before the agent starts: its skill may finish before any later render observes this.
    markRequested(missingKinds);
    // attachAgent guards its own re-entry (a second click while one is in flight silently no-ops),
    // so no local "launching" flag is needed for *correctness* -- but the click still needs some
    // visible feedback while `attachAgent` awaits gitPreflight/create/start (a real few seconds),
    // or the button reads as unresponsive/delayed. `isLaunchingAgent` is the same store field
    // RootCanvas.tsx's own "Run agent" button already disables on, kept in sync here so both
    // agent-launch buttons agree on what "busy" means.
    void attachAgent(agentClient, null, buildDrawDiagramTask(missingLabels, anyGeneratedReady)).catch(
      (err: unknown) => setError(err instanceof Error ? err.message : "couldn't open an agent"),
    );
  };

  return (
    <div className="draw-diagram-button-wrap">
      <RailButton
        className="draw-diagram-button"
        testId="draw-diagram-button"
        label="Draw…"
        disabled={isAtAgentCapacity || isLaunchingAgent}
        tooltip={
          isAtAgentCapacity
            ? `${maxAgents} agents is the limit — close one to start another`
            : isLaunchingAgent
              ? "Launching…"
              : undefined
        }
        onClick={onDrawDiagram}
      >
        <RailIcon name="custom" />
      </RailButton>
      {error && (
        <p className="draw-diagram-button-error" data-testid="draw-diagram-button-error">
          {error}
        </p>
      )}
    </div>
  );
}
