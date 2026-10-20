import type { EngineClient } from "../../engine-client/EngineClient";
import { shellStore, type ArrangeMode } from "../../shell/shellStore";
import { collapsedLayersStore } from "./collapsedLayersStore";
import type { CanvasPosition } from "../../state/types";
import type { Rect } from "../connectors/orthogonalRoute";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { arrangeLayers } from "./arrangeLayers";
import { canvasDocStore, commitCanvasPositions, onUserCommit } from "./canvasDocStore";
import { captureLayerPositions } from "./layerPositionCache";

export interface ArrangeDeps {
  engineClient: EngineClient;
  selectedLayers: readonly string[];
  fitToBounds: (rect: Rect) => void;
  sizes?: ReadonlyMap<string, MeasuredBoxSize>;
}

let snapshot: Record<string, CanvasPosition> | null = null;

/** Discards the pre-arrange snapshot and the active mode; call from the drag-commit path and on Ctrl+Z of an arrange. */
export function clearArrange(): void {
  snapshot = null;
  if (shellStore.getState().arrangeMode !== null) shellStore.setArrangeMode(null);
}

onUserCommit(clearArrange);

/** Puts every arranged element back where it was before the first arrange, as one undo entry. */
export function restoreArrange(deps: Pick<ArrangeDeps, "engineClient">): void {
  if (snapshot) commitCanvasPositions(deps.engineClient, snapshot, { programmatic: true });
  clearArrange();
}

/** Arranges the selected diagrams in `mode`; the active mode again restores the pre-arrange positions. */
export function applyArrange(mode: ArrangeMode, deps: ArrangeDeps): void {
  if (shellStore.getState().arrangeMode === mode && snapshot) {
    restoreArrange(deps);
    return;
  }
  const doc = canvasDocStore.getDoc();
  const { moves, packedBounds } = arrangeLayers({
    doc,
    selectedLayers: deps.selectedLayers,
    hiddenLayers: [...collapsedLayersStore.getCollapsed()],
    mode,
    sizes: deps.sizes,
  });
  if (moves.length === 0) return;

  const entering = snapshot === null;
  const saved = snapshot ?? {};
  for (const { id } of moves) {
    const el = doc.elements[id];
    if (el && !saved[id]) saved[id] = el.position;
  }
  snapshot = saved;
  if (entering) {
    const layers = new Set(moves.map((m) => doc.elements[m.id]?.layer));
    for (const layer of layers) {
      if (layer) captureLayerPositions(Object.values(doc.elements).filter((e) => e.layer === layer), layer);
    }
  }

  const positions: Record<string, CanvasPosition> = {};
  for (const m of moves) positions[m.id] = m.position;
  commitCanvasPositions(deps.engineClient, positions, { programmatic: true });
  shellStore.setArrangeMode(mode);
  deps.fitToBounds(packedBounds);
}
