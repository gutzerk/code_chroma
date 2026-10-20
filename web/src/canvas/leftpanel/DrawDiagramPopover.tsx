import { useState } from "react";
import { attachAgent } from "../../agents/attachAgent";
import { useAgentClient } from "../../agents/AgentClientContext";
import { useIsAtAgentCapacity, useIsLaunchingAgent } from "../../agents/agentStore";
import { tutorialSimStore } from "../../tutorial/tutorialSim";
import { tutorialStore } from "../../tutorial/tutorialStore";
import { chromeInsets, Z_POPOVER } from "../layout/layoutMetrics";
import { useLayoutState } from "../layout/layoutStore";
import "./DrawDiagramPopover.css";

export const DRAW_OPTIONS = [
  { id: "c1", label: "C1 · system context", phrase: "C1 system-context" },
  { id: "patterns", label: "Patterns", phrase: "design-patterns" },
  { id: "impact", label: "Impact", phrase: "change-impact" },
  { id: "epics", label: "Epics", phrase: "epics" },
  { id: "custom", label: "Custom…", phrase: "custom" },
] as const;

/** The agent task for one chosen diagram type (Custom asks the user what to draw). */
export function buildDrawOptionTask(phrase: string): string {
  if (phrase === "custom") {
    return (
      "The user wants a custom diagram of this project. Ask what they would like to see, then use the " +
      "codechroma-draw-diagram skill (custom type) to draw it."
    );
  }
  return (
    `The user wants a ${phrase} diagram of this project. Use the codechroma-draw-diagram skill ` +
    "and pick the matching type from its router table to draw it."
  );
}

interface DrawDiagramPopoverProps {
  onClose: () => void;
}

/** The "Ask an agent to draw" popover: each option launches an agent with the matching draw task. */
export function DrawDiagramPopover({ onClose }: DrawDiagramPopoverProps) {
  const agentClient = useAgentClient();
  const isLaunching = useIsLaunchingAgent();
  const atCapacity = useIsAtAgentCapacity();
  const { leftOpen, agentsMode } = useLayoutState();
  const [error, setError] = useState<string | null>(null);
  const { drawPopover } = chromeInsets({ leftOpen, agentsMode });

  const choose = (phrase: string) => {
    setError(null);
    if (tutorialStore.isActive()) {
      tutorialSimStore.openAgent();
      onClose();
      return;
    }
    attachAgent(agentClient, null, buildDrawOptionTask(phrase))
      .then(onClose)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "couldn't open an agent"),
      );
  };

  return (
    <div
      role="dialog"
      aria-label="Draw a diagram"
      className="draw-diagram-popover"
      data-testid="draw-diagram-popover"
      style={{ left: drawPopover.left, top: drawPopover.top, zIndex: Z_POPOVER }}
    >
      <div className="draw-diagram-popover-header">
        <span>Ask an agent to draw</span>
        <button
          type="button"
          className="draw-diagram-popover-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {DRAW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className="draw-diagram-popover-option"
          disabled={atCapacity || isLaunching}
          onClick={() => choose(option.phrase)}
        >
          {option.label}
        </button>
      ))}
      {error && (
        <p className="draw-diagram-popover-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
