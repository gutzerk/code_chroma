import { useMemo } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { useCanvasDoc } from "../doc/canvasDocStore";
import { collapsedLayersStore, useCollapsedLayers } from "../doc/collapsedLayersStore";
import { listActiveDiagramLayers, useCustomDiagramTypes } from "../doc/diagramCatalog";
import { diagramDisplayName } from "../doc/diagramDisplay";

export interface DiagramRow {
  layer: string;
  /** The diagram's own `title` when it has one, else its type label. */
  name: string;
  /** The diagram type, shown as a small secondary label only when `name` is a real title. */
  typeLabel?: string;
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
        const display = diagramDisplayName(layer, doc, customTypes);
        const name = display.name;
        const hidden = collapsed.has(layer);
        return {
          layer,
          name,
          typeLabel: display.titled ? display.typeLabel : undefined,
          hidden,
          toggleLabel: `${hidden ? "Show" : "Hide"} ${name}`,
          toggle: () => collapsedLayersStore.toggle(layer),
        };
      }),
    [doc, customTypes, collapsed],
  );
}
