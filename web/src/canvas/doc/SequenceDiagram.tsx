import { useMemo, useSyncExternalStore } from "react";
import { buildSequenceModel } from "./sequenceModel";
import type { CanvasElement } from "../../state/types";
import { stringMeta } from "./elementMeta";
import { SequenceFocus } from "./SequenceFocus";
import { SequenceReadable } from "./SequenceReadable";
import { sequenceViewStore } from "./sequenceViewStore";

/**
 * Renders one whole `sequence` layer in the display mode the viewer picked (`Readable` or `Focus`).
 *
 * Both modes consume the same elements through `sequenceModel.ts`; the mode is a display preference
 * kept in `sequenceViewStore` and never part of the persisted element geometry. Geometry is drawn at
 * each element's persisted `position` (written by `layoutSequence`), so `DiagramFrame` encloses the
 * same rects. Purely display: no drag of its own; clicking a message opens the description popup.
 */
export interface SequenceDiagramProps {
  layer: string;
  elements: CanvasElement[];
}

export function SequenceDiagram({ layer, elements }: SequenceDiagramProps) {
  useSyncExternalStore(sequenceViewStore.subscribe, sequenceViewStore.getVersion);
  const messageCount = elements.filter((e) => stringMeta(e, "role") === "message").length;
  const view = sequenceViewStore.get(layer, messageCount);
  const model = useMemo(() => buildSequenceModel(elements), [elements]);
  return view.mode === "focus" ? (
    <SequenceFocus layer={layer} model={model} view={view} />
  ) : (
    <SequenceReadable layer={layer} model={model} />
  );
}
