import { ArrowMarkerDefs } from "../connectors/ArrowMarkerDefs";
import { RelationshipEdge } from "../connectors/RelationshipEdge";
import { layoutDiagramEdges } from "../connectors/diagramLayout";
import type { Rect } from "../connectors/orthogonalRoute";
import type { CanvasDoc } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { elementRect } from "./elementRect";

const CANVAS_ARROW_MARKER_ID = "canvas-doc-arrowhead";

// Reuses the custom-diagram arrowhead styling as a neutral default (see elementRules.ts's own note
// on the c1 gap) — module-level so the <defs> block stays stable (Safari drops markers otherwise).
const CANVAS_ARROW_MARKERS = [{ id: CANVAS_ARROW_MARKER_ID, className: "custom-arrowhead" }];

export interface CanvasEdgesProps {
  doc: CanvasDoc;
  /** Each box's real rendered size (plus its own CSS margin-left/-top), keyed by element id
   * (CanvasDocView's useMeasuredSizes). A box only ever grows right/down past `element.size`/the
   * default (its `left`/`top` are pinned to the *assumed* size; see CanvasNodeBox), so routing must
   * keep that same pinned left/top but size the rect to the real footprint once it's known, or an
   * arrow/label routes as if the box were still its smaller default and ends up landing on the part
   * it actually grew into. The margin matters for the same reason from the other direction: CSS
   * `left`/`top` place a box's *margin* edge, so a box whose render kind sets a non-zero margin
   * (`.block`'s 0.4rem, unlike `.diagram-node-box`'s none) renders its real border-box shifted
   * right/down from `element.position` by exactly that much, and every anchor needs to shift with
   * it. Missing until the first ResizeObserver callback lands, so every lookup falls back to the
   * assumed size and zero margin regardless. */
  sizes?: ReadonlyMap<string, MeasuredBoxSize>;
  /** Opens the code at a resolved edge's caller — passed to every edge that carries an `origin`,
   * wiring the label click to the code sidebar (see openOrigin). */
  onOpenOrigin: (origin: string) => void;
}

/**
 * One relationship arrow per doc.edges entry, routed off each element's own persisted position —
 * unlike the old per-view Connections components, nothing here re-runs dagre: positions are the
 * document's own truth, this just obstacle-routes a line between whatever they already are. Mirrors
 * CustomConnections/ImpactConnections's shape (ArrowMarkerDefs + RelationshipEdge per edge).
 */
export function CanvasEdges({ doc, sizes, onOpenOrigin }: CanvasEdgesProps) {
  const rectByKey = new Map<string, Rect>(
    Object.values(doc.elements).map((element) => [element.id, elementRect(element, sizes)]),
  );
  const edges = layoutDiagramEdges(Object.values(doc.edges), rectByKey);

  return (
    <>
      <ArrowMarkerDefs markers={CANVAS_ARROW_MARKERS} />
      {edges.map((edge) => (
        <RelationshipEdge
          key={edge.key}
          edgeKey={edge.key}
          d={edge.d}
          label={edge.label || edge.kind || ""}
          transport={edge.transport}
          labelX={edge.labelX}
          labelY={edge.labelY}
          markerId={CANVAS_ARROW_MARKER_ID}
          fromNodeId={edge.from}
          toNodeId={edge.to}
          variantSuffix=" --custom"
          isHero={edge.hero}
          style={edge.style}
          origin={edge.origin}
          onOpenOrigin={onOpenOrigin}
          testId="canvas-doc-relationship"
        />
      ))}
    </>
  );
}
