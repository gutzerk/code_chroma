import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attachAgent } from "../../agents/attachAgent";
import { useAgentClient } from "../../agents/AgentClientContext";
import { useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../agents/agentStore";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { DiagramsStatus } from "../../state/types";
import { RailIcon } from "../../icons/RailIcon";
import { RailButton } from "../RailButton";
import { tutorialSimStore } from "../../tutorial/tutorialSim";
import { tutorialStore } from "../../tutorial/tutorialStore";
import { canvasDocStore, collectActiveLayers, useCanvasDoc } from "./canvasDocStore";
import {
  computeReadyDiagrams,
  runRecipeAndLayout,
  useCustomDiagramTypes,
  WATCHED_DIAGRAM_EVENT_KINDS,
} from "./diagramCatalog";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";

/** Builds the agent's actionable first message for "Draw…" -- it always names every diagram type,
 * whether or not one is already drawn, so the user gets the full menu every time and never has to
 * remove an existing diagram to redraw it. ("Draw…" is a fresh-draw launcher; whether a diagram
 * already sits on the canvas is irrelevant to what the user may draw again.)
 *
 * `labels` has no upper bound (every built-in plus every saved custom type), but a multiple-choice
 * tool call caps out at 4 options -- asking the agent to offer more than that as a single such call
 * fails with a schema-validation error the user just sees as "Invalid tool parameters", with no
 * diagram drawn and the agent stuck. Past 4, the prompt tells it to ask in plain text instead, so
 * the option count never collides with that cap. */
export function buildDrawDiagramTask(labels: string[], anyAlreadyReady: boolean): string {
  const article = anyAlreadyReady ? "another" : "a";
  if (labels.length === 0) {
    return (
      `The user wants ${article} diagram of this project. Every built-in and saved diagram type is ` +
      "already drawn -- ask what new diagram they'd like (redrawing something existing, or a fresh " +
      "one-off custom diagram), then use the codechroma-draw-diagram skill to draw it."
    );
  }
  const askHint =
    labels.length > 4
      ? " (more than 4 -- list them in your reply as plain text, not a multiple-choice tool call)"
      : "";
  return (
    `The user wants ${article} diagram of this project. Ask which kind they'd like${askHint} -- ` +
    `${labels.join(", ")} -- then use the codechroma-draw-diagram skill and pick the ` +
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
 * Still tracks readiness in the background — `buildDrawDiagramTask` always enumerates every type
 * regardless of readiness, and `refetchStatus` below auto-adds any kind that becomes ready (whoever
 * drew it), so a diagram this button launched, or one an agent-window/terminal run wrote, appears on
 * the canvas without a reload.
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
   * Refetches the per-kind readiness map, then auto-adds every kind that just became ready and is
   * not yet on the canvas -- plus re-runs the recipe for a kind already on the canvas whose content
   * fingerprint just changed (an in-place edit of an already-drawn diagram). The one place status is
   * fetched, shared by the mount effect and the per-kind watcher subscriptions.
   *
   * The add is unconditional (no pending-request gate): a diagram that exists on disk and is ready
   * but not placed should appear, whoever wrote it -- the "Draw…" button, a terminal/agent-window
   * run, another agent on the same workspace. Ping scoping (`isForAnotherWorkspace`) and the
   * `!placed.has(kind)` check keep it from reacting to unrelated artifacts, and the `before === null`
   * guard means a first-ever visit adds nothing. A fingerprint change on a diagram already placed
   * needs no gate either -- it only updates content fields (never position/size, see recipes.py), so
   * refreshing is never a surprise, just the picture catching up with what is already on disk.
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

  const { allLabels, anyGeneratedReady } = useMemo(
    () => computeReadyDiagrams(status, customTypes, activeLayers),
    [status, customTypes, activeLayers],
  );

  const onDrawDiagram = () => {
    setError(null);
    // The tutorial opens a scripted mock agent instead of launching a real one.
    if (tutorialStore.isActive()) {
      tutorialSimStore.openAgent();
      return;
    }
    // A ready-but-unplaced diagram is added automatically regardless of who wrote it — the "Draw…"
    // button included — so there is no pending-request set to mark here (the old `pendingDrawRequests`
    // gate, removed).
    // attachAgent guards its own re-entry (a second click while one is in flight silently no-ops),
    // so no local "launching" flag is needed for *correctness* -- but the click still needs some
    // visible feedback while `attachAgent` awaits gitPreflight/create/start (a real few seconds),
    // or the button reads as unresponsive/delayed. `isLaunchingAgent` is the same store field
    // RootCanvas.tsx's own "Run agent" button already disables on, kept in sync here so both
    // agent-launch buttons agree on what "busy" means.
    void attachAgent(agentClient, null, buildDrawDiagramTask(allLabels, anyGeneratedReady)).catch(
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
