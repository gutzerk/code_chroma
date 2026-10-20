import { useMemo, useState } from "react";
import { attachAgent } from "../../agents/attachAgent";
import { useAgentClient } from "../../agents/AgentClientContext";
import { useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../agents/agentStore";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { RailIcon } from "../../icons/RailIcon";
import { RailButton } from "../RailButton";
import { tutorialSimStore } from "../../tutorial/tutorialSim";
import { tutorialStore } from "../../tutorial/tutorialStore";
import { collectActiveLayers, useCanvasDoc } from "./canvasDocStore";
import { computeReadyDiagrams, useCustomDiagramTypes } from "./diagramCatalog";
import { readCachedDiagramsStatus } from "./diagramStatusCache";
import { useDiagramWatcherError } from "./diagramWatcherErrorStore";

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

/** The draw-agent task for one already-picked diagram kind (`DrawPopover`), so the agent skips the "which kind?" question. */
export function buildPickedDrawTask(kindLabel: string, custom = false): string {
  if (custom) {
    return (
      "The user wants a custom diagram of this project. Ask what it should show (or which saved custom " +
      "type to draw), then use the codechroma-draw-diagram skill (custom type) to draw it."
    );
  }
  return (
    `The user wants a ${kindLabel} diagram of this project. Do not ask which kind -- use the ` +
    `codechroma-draw-diagram skill and pick the ${kindLabel} type from its router table to draw it.`
  );
}

/**
 * The rail's "Draw…" button (016-single-canvas-dashboard Stage 4, shrunk in the diagram-management
 * unification that retired `RecipeMenu`'s dropdown and the custom-diagram-type wizard): a single
 * action, always clickable, that opens an agent already asking what to draw
 * (`codechroma-draw-diagram`). It does not list or toggle diagrams anymore -- every diagram that
 * exists, ready or already placed, is shown and managed from the left panel's Diagrams tab instead;
 * this button's only job is starting a new draw.
 *
 * Readiness tracking and the auto-add of newly ready diagrams live in
 * `useDiagramReadinessWatcher` (mounted once by `RootCanvas`); this button only reads its cached map.
 */
export function DrawDiagramButton({
  onOpen,
}: {
  /** Replaces the direct agent launch (the left panel opens the type popover instead). */
  onOpen?: () => void;
} = {}) {
  const engineClient = useEngineClient();
  const agentClient = useAgentClient();
  const isLaunchingAgent = useIsLaunchingAgent();
  const isAtAgentCapacity = useIsAtAgentCapacity();
  const maxAgents = useMaxAgents();
  const doc = useCanvasDoc();
  const activeLayers = useMemo(() => collectActiveLayers(doc), [doc]);
  const customTypes = useCustomDiagramTypes(engineClient);
  const [launchError, setError] = useState<string | null>(null);
  const watcherError = useDiagramWatcherError();
  const error = launchError ?? watcherError;

  const onDrawDiagram = () => {
    setError(null);
    if (onOpen) {
      onOpen();
      return;
    }
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
    // The watcher (`useDiagramReadinessWatcher`) keeps the cached readiness map fresh.
    const { allLabels, anyGeneratedReady } = computeReadyDiagrams(
      readCachedDiagramsStatus(),
      customTypes,
      activeLayers,
    );
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
        <RailIcon name="draw" /><span>Draw…</span>
      </RailButton>
      {error && (
        <p className="draw-diagram-button-error" data-testid="draw-diagram-button-error">
          {error}
        </p>
      )}
    </div>
  );
}
