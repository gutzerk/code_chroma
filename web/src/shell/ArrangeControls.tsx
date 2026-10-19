import type { Rect } from "../canvas/connectors/orthogonalRoute";
import { applyArrange } from "../canvas/doc/arrangeController";
import { useEngineClient } from "../engine-client/EngineClientContext";
import "./arrangeControls.css";
import { useSelectedLayers } from "./diagramSelectionStore";
import { useShellState, type ArrangeMode } from "./shellStore";

const OPTIONS: Array<{ mode: ArrangeMode; label: string }> = [
  { mode: "side", label: "Side by side" },
  { mode: "stack", label: "Stack" },
  { mode: "grid", label: "Grid" },
];

export interface ArrangeControlsProps {
  fitToBounds: (rect: Rect) => void;
}

/** The "Arrange selected" segmented control of the Diagrams tab. */
export function ArrangeControls({ fitToBounds }: ArrangeControlsProps) {
  const engineClient = useEngineClient();
  const selected = useSelectedLayers();
  const { arrangeMode } = useShellState();
  const disabled = selected.length < 1;
  return (
    <div className="arrange-controls">
      <div className="arrange-controls-label">ARRANGE SELECTED · {selected.length}</div>
      <div className="arrange-controls-segments" role="group" aria-label="Arrange selected diagrams">
        {OPTIONS.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            className="arrange-controls-btn"
            aria-pressed={arrangeMode === mode}
            disabled={disabled}
            onClick={() => applyArrange(mode, { engineClient, selectedLayers: selected, fitToBounds })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="arrange-controls-hint">
        Click the active option again to put diagrams back where you dragged them.
      </div>
    </div>
  );
}
