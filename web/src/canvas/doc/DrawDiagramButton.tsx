import { useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../agents/agentStore";
import { RailIcon } from "../../icons/RailIcon";
import { RailButton } from "../RailButton";
import { tutorialSimStore } from "../../tutorial/tutorialSim";
import { tutorialStore } from "../../tutorial/tutorialStore";
import { useDiagramWatcherError } from "./diagramWatcherErrorStore";
import { drawDialogStore } from "./drawDialog/drawDialogStore";

/**
 * The rail's "Draw…" button (016-single-canvas-dashboard Stage 4, shrunk in the diagram-management
 * unification that retired `RecipeMenu`'s dropdown and the custom-diagram-type wizard): a single
 * action that opens the Draw dialog (`drawDialog/DrawDialog.tsx`, 025), where the user picks a
 * diagram type and says what to show; the dialog then launches the `codechroma-draw-diagram`
 * agent. It does not list or toggle diagrams anymore -- every diagram that
 * exists, ready or already placed, is shown and managed from the left panel's Diagrams tab instead;
 * this button's only job is starting a new draw.
 *
 * Readiness tracking and the auto-add of newly ready diagrams live in
 * `useDiagramReadinessWatcher` (mounted once by `RootCanvas`); this button only reads its cached map.
 */
export function DrawDiagramButton() {
  const isLaunchingAgent = useIsLaunchingAgent();
  const isAtAgentCapacity = useIsAtAgentCapacity();
  const maxAgents = useMaxAgents();
  const error = useDiagramWatcherError();

  const onDrawDiagram = () => {
    // The tutorial opens a scripted mock agent instead of the dialog.
    if (tutorialStore.isActive()) {
      tutorialSimStore.openAgent();
      return;
    }
    drawDialogStore.open();
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
