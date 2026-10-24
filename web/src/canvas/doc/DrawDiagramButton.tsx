import { useState } from "react";
import { attachAgent } from "../../agents/attachAgent";
import { useAgentClient } from "../../agents/AgentClientContext";
import { useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../agents/agentStore";
import { RailIcon } from "../../icons/RailIcon";
import { RailButton } from "../RailButton";
import { tutorialSimStore } from "../../tutorial/tutorialSim";
import { tutorialStore } from "../../tutorial/tutorialStore";
import { useDiagramWatcherError } from "./diagramWatcherErrorStore";

/** The agent's fallback first message for "Draw…"; a bare agent ignores it and the terminal window asks what to draw. */
const DRAW_DIAGRAM_TASK = "Draw a diagram of this project using the codechroma-draw-diagram skill.";

/**
 * The rail's "Draw…" button (016-single-canvas-dashboard Stage 4, shrunk in the diagram-management
 * unification that retired `RecipeMenu`'s dropdown and the custom-diagram-type wizard): a single
 * action, always clickable, that opens an agent window (`codechroma-draw-diagram`) whose terminal
 * itself asks what to draw -- the bridge prints the question, so the agent never greets or asks. It does not list or toggle diagrams anymore -- every diagram that
 * exists, ready or already placed, is shown and managed from the left panel's Diagrams tab instead;
 * this button's only job is starting a new draw.
 *
 * Readiness tracking and the auto-add of newly ready diagrams live in
 * `useDiagramReadinessWatcher` (mounted once by `RootCanvas`); this button only reads its cached map.
 */
export function DrawDiagramButton() {
  const agentClient = useAgentClient();
  const isLaunchingAgent = useIsLaunchingAgent();
  const isAtAgentCapacity = useIsAtAgentCapacity();
  const maxAgents = useMaxAgents();
  const [launchError, setError] = useState<string | null>(null);
  const watcherError = useDiagramWatcherError();
  const error = launchError ?? watcherError;

  const onDrawDiagram = () => {
    setError(null);
    // The tutorial opens a scripted mock agent instead of launching a real one.
    if (tutorialStore.isActive()) {
      tutorialSimStore.openAgent();
      return;
    }
    // attachAgent guards its own re-entry; `isLaunchingAgent` (also what RootCanvas's "Run agent"
    // disables on) gives the button visible feedback during the few seconds a launch takes.
    void attachAgent(agentClient, null, DRAW_DIAGRAM_TASK, { type: "any" }).catch(
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
