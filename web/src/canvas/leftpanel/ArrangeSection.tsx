import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { CanvasElement } from "../../state/types";
import { readSavedCameraView } from "../canvasCameraStore";
import { canvasDocStore, useCanvasDoc } from "../doc/canvasDocStore";
import { commitCanvasPositions } from "../doc/canvasDocSync";
import { PADDING as FRAME_PADDING } from "../doc/DiagramFrame";
import { elementRect } from "../doc/elementRect";
import { chromeInsets } from "../layout/layoutMetrics";
import { useLayoutState } from "../layout/layoutStore";
import {
  computeArrangement,
  unionRects,
  type ArrangeMode,
  type DiagramBox,
} from "./arrangeLayout";
import { arrangeStore, useArrangeMode } from "./arrangeStore";
import { useSelectedDiagrams } from "./diagramSelectionStore";
import "./ArrangeSection.css";

type ActiveMode = Exclude<ArrangeMode, "free">;

const MODES: { mode: ActiveMode; label: string }[] = [
  { mode: "side", label: "Side by side" },
  { mode: "stack", label: "Stack" },
  { mode: "grid", label: "Grid (2 columns)" },
];

export interface ArrangeViewport {
  width: number;
  height: number;
}

interface ArrangeSectionProps {
  /** Reads the canvas stage size in screen px at apply time; defaults to the window. */
  getViewport?: () => ArrangeViewport | undefined;
  /** The camera that maps the screen-space origin to canvas coordinates; defaults to the saved one. */
  camera?: { x: number; y: number; scale: number };
}

function boxesFor(layers: readonly string[], elements: CanvasElement[]): DiagramBox[] {
  const boxes: DiagramBox[] = [];
  for (const layer of layers) {
    const bounds = unionRects(elements.filter((e) => e.layer === layer).map((e) => elementRect(e)));
    // Slot the diagram's dashed frame (members plus its padding band), not just its boxes, so
    // neighbouring frames never overlap.
    if (bounds) {
      boxes.push({
        layer,
        bounds: {
          left: bounds.left - FRAME_PADDING.side,
          top: bounds.top - FRAME_PADDING.top,
          width: bounds.width + FRAME_PADDING.side * 2,
          height: bounds.height + FRAME_PADDING.top + FRAME_PADDING.bottom,
        },
      });
    }
  }
  return boxes;
}

/** Arranges the ticked diagrams side by side, stacked or in a 2-column grid via the canvas doc write path. */
export function ArrangeSection({ getViewport, camera }: ArrangeSectionProps) {
  const engineClient = useEngineClient();
  const doc = useCanvasDoc();
  const selected = useSelectedDiagrams();
  const mode = useArrangeMode();
  const { leftOpen, agentsMode } = useLayoutState();

  const apply = (next: ActiveMode) => {
    const all = Object.values(canvasDocStore.getDoc().elements);
    const diagramLayers = [...new Set(all.filter((e) => e.layer !== "hierarchy").map((e) => e.layer))];
    const selectedLayers = selected.filter((l) => diagramLayers.includes(l));
    const selectedBoxes = boxesFor(selectedLayers, all);
    if (selectedBoxes.length === 0) return;
    const others = boxesFor(
      diagramLayers.filter((l) => !selectedLayers.includes(l)),
      all,
    );
    const insets = chromeInsets({ leftOpen, agentsMode });
    const cam = camera ?? readSavedCameraView() ?? { x: 0, y: 0, scale: 1 };
    const viewport = getViewport?.();
    const vw = viewport?.width ?? window.innerWidth;
    const vh = viewport?.height ?? window.innerHeight;
    const toWorldX = (sx: number) => (sx - cam.x) / cam.scale;
    const toWorldY = (sy: number) => (sy - cam.y) / cam.scale;
    const { offsets } = computeArrangement(next, selectedBoxes, others, {
      originX: toWorldX(insets.arrangeOrigin.x),
      originY: toWorldY(insets.arrangeOrigin.y),
      rightEdge: toWorldX(vw - insets.terminalRight),
      bottomEdge: toWorldY(vh - 16),
    });
    const original: Record<string, { x: number; y: number }> = {};
    const positions: Record<string, { x: number; y: number }> = {};
    for (const element of all) {
      const offset = offsets[element.layer];
      if (!offset) continue;
      original[element.id] = element.position;
      positions[element.id] = {
        x: element.position.x + offset.dx,
        y: element.position.y + offset.dy,
      };
    }
    arrangeStore.enter(next, original, positions);
    commitCanvasPositions(engineClient, positions);
  };

  const onClick = (next: ActiveMode) => {
    if (mode !== next) {
      apply(next);
      return;
    }
    const existing = canvasDocStore.getDoc().elements;
    const current = Object.fromEntries(Object.entries(existing).map(([id, e]) => [id, e.position]));
    const restored = arrangeStore.leave(current);
    if (Object.keys(restored).length > 0) commitCanvasPositions(engineClient, restored);
  };

  const count = selected.filter((l) =>
    Object.values(doc.elements).some((e) => e.layer === l),
  ).length;

  return (
    <div className="arrange-section" data-testid="arrange-section">
      <div className="arrange-section-label">{`Arrange selected · ${count}`}</div>
      <div className="arrange-section-buttons">
        {MODES.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            className="arrange-section-button"
            aria-pressed={mode === m}
            disabled={count === 0 && mode !== m}
            onClick={() => onClick(m)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
