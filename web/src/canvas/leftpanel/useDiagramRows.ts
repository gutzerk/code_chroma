import { useMemo } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { useCanvasDoc } from "../doc/canvasDocStore";
import { collapsedLayersStore, useCollapsedLayers } from "../doc/collapsedLayersStore";
import {
  labelForDiagramLayer,
  listActiveDiagramLayers,
  useCustomDiagramTypes,
} from "../doc/diagramCatalog";

export interface DiagramRow {
  layer: string;
  name: string;
  hidden: boolean;
  /** The visibility toggle's accessible label ("Hide X" / "Show X"). */
  toggleLabel: string;
  toggle: () => void;
}

/** The active diagram layers as rows with display name, hidden flag and the visibility toggle. */
export function useDiagramRows(): DiagramRow[] {
  const engineClient = useEngineClient();
  const doc = useCanvasDoc();
  const customTypes = useCustomDiagramTypes(engineClient);
  const collapsed = useCollapsedLayers();
  return useMemo(
    () =>
      listActiveDiagramLayers(doc).map((layer) => {
        const name = labelForDiagramLayer(layer, customTypes, doc);
        const hidden = collapsed.has(layer);
        return {
          layer,
          name,
          hidden,
          toggleLabel: `${hidden ? "Show" : "Hide"} ${name}`,
          toggle: () => collapsedLayersStore.toggle(layer),
        };
      }),
    [doc, customTypes, collapsed],
  );
}
