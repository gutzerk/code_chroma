import { diagramAccent } from "../doc/diagramDisplay";

/** The diagram frame's accent, shared by the expanded and collapsed panel swatches. */
export function colorForLayer(layer: string): string {
  return diagramAccent(layer).color;
}
