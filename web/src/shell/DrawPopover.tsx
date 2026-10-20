import { useState } from "react";
import { attachAgent } from "../agents/attachAgent";
import { useAgentClient } from "../agents/AgentClientContext";
import { buildPickedDrawTask } from "../canvas/doc/DrawDiagramButton";
import { tutorialSimStore } from "../tutorial/tutorialSim";
import { tutorialStore } from "../tutorial/tutorialStore";

export type DrawKind = "c1" | "patterns" | "impact" | "epics" | "custom";

const OPTIONS: { kind: DrawKind; label: string; task: string }[] = [
  { kind: "c1", label: "C1 · system context", task: "C1 system context" },
  { kind: "patterns", label: "Patterns", task: "design patterns" },
  { kind: "impact", label: "Impact", task: "change impact" },
  { kind: "epics", label: "Epics", task: "epics" },
  { kind: "custom", label: "Custom…", task: "custom" },
];

export interface DrawPopoverProps {
  /** Overrides the default draw path (opens an agent with the kind preselected). */
  onPick?: (kind: DrawKind) => void;
  onClose?: () => void;
}

/** Popover listing the diagram kinds; a pick starts the draw agent with that kind preselected. */
export function DrawPopover({ onPick, onClose }: DrawPopoverProps) {
  const agentClient = useAgentClient();
  const [error, setError] = useState<string | null>(null);

  const pick = (option: (typeof OPTIONS)[number]) => {
    setError(null);
    if (onPick) {
      onPick(option.kind);
      onClose?.();
      return;
    }
    if (tutorialStore.isActive()) {
      tutorialSimStore.openAgent();
      onClose?.();
      return;
    }
    const task = buildPickedDrawTask(option.task, option.kind === "custom");
    void attachAgent(agentClient, null, task)
      .then(() => onClose?.())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "couldn't open an agent"));
  };

  return (
    <div className="draw-popover" role="menu" aria-label="Draw a diagram" data-testid="draw-popover">
      {OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          role="menuitem"
          className="draw-popover-item"
          data-testid={`draw-popover-${option.kind}`}
          onClick={() => pick(option)}
        >
          {option.label}
        </button>
      ))}
      {error && (
        <p className="draw-popover-error" data-testid="draw-popover-error">
          {error}
        </p>
      )}
    </div>
  );
}
