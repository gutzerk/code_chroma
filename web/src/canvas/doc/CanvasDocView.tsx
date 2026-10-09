import { useEffect, useMemo } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { DiagramRelationshipsSvg } from "../DiagramSurface";
import { useMeasuredSizes } from "../useMeasuredSizes";
import { CanvasEdges } from "./CanvasEdges";
import { openOrigin } from "../openOrigin";
import { CanvasNodeBox } from "./CanvasNodeBox";
import { ConcurrencyIslandArea } from "./ConcurrencyIslandArea";
import { DiagramFrame } from "./DiagramFrame";
import { isDiagramLayer, labelForDiagramLayer, useCustomDiagramTypes } from "./diagramCatalog";
import { BLOCK_RULES } from "./elementRules";
import { elementRect } from "./elementRect";
import { leadingOrderDigits, stringMeta } from "./elementMeta";
import { GroupFrame } from "./GroupFrame";
import { LaneArea } from "./LaneArea";
import { NoteElement } from "./NoteElement";
import { SequenceDiagram } from "./SequenceDiagram";
import {
  applyCanvasPositions,
  useCanvasDoc,
  useCanvasDocLoaded,
  useLoadCanvasDoc,
} from "./canvasDocStore";
import { useCollapsedLayers } from "./collapsedLayersStore";
import { useLiveDragOffsets } from "./dragOffsetStore";
import { useReflowEpics } from "./useReflowEpics";
import { useReflowSequence } from "./useReflowSequence";
import { useEpicsContentSizes } from "./epicsContentSizeStore";
import { UNDO_EVENT, type UndoEventDetail } from "../UndoManager";

const CANVAS_MARGIN = 400;


/** Resolves a group/Lane/Concurrency-island's member ids against `visibleDoc`'s live-drag-adjusted
 * elements, dropping any id no longer present -- shared by all three area renderers below so a
 * member removed mid-drag (or never resolved in the first place) can't leave a `undefined` in the
 * list any of them hands to `unionBoundsOf`. */
function resolveMembers(ids: readonly string[], elements: Record<string, CanvasElement>): CanvasElement[] {
  return ids
    .map((id) => elements[id])
    .filter((member): member is CanvasElement => member !== undefined);
}

/** A derived per-diagram grouping (Lane/Concurrency island, 054-diagram-flow-order): one entry per
 * distinct `<layer>|<value>` pair. The flat list carries the owning `layer` so the render loop can
 * key its React elements uniquely -- without it, two diagrams sharing a lane name would collide in a
 * single LaneArea array. */
type LayeredValueBucket = { layer: string; value: string; ids: string[] };

/** Buckets box ids by `valueOf`, partitioned by diagram `layer` so two identical values on *different*
 * layers never merge into one group spanning diagram frames (the layer-scoping `memberIdsByLayer`
 * gives `DiagramFrame`). `valueOf` returns `undefined` for a box that has no grouping value. When
 * `keepSingletons` is false a value seen on only one box is dropped (a lone numbered step has nothing
 * to be concurrent with). Shared by the Lane and Concurrency island builders, whose only differences
 * -- the value extractor and the singleton rule -- are both parameters. */
function bucketPerLayer(
  elements: readonly CanvasElement[],
  valueOf: (element: CanvasElement) => string | undefined,
  keepSingletons: boolean,
): LayeredValueBucket[] {
  const layers = new Map<string, Map<string, string[]>>();
  for (const element of elements) {
    const value = valueOf(element);
    if (value === undefined) continue;
    let values = layers.get(element.layer);
    if (!values) layers.set(element.layer, (values = new Map()));
    const ids = values.get(value);
    if (ids) ids.push(element.id);
    else values.set(value, [element.id]);
  }
  const buckets: LayeredValueBucket[] = [];
  for (const [layer, values] of layers) {
    for (const [value, ids] of values) {
      if (keepSingletons || ids.length >= 2) buckets.push({ layer, value, ids });
    }
  }
  return buckets;
}

/** Restores whatever positions Ctrl/Cmd+Z popped for the "canvas" undo kind (see UndoManager,
 * undoStore) through the same optimistic apply+PATCH path a real drag uses -- so it settles
 * instantly and gets the same fetch-race protection canvasDocStore's own `_latestFetchSeq` already
 * gives every other write here. Deliberately does NOT call undoStore.recordCommit: restoring a
 * popped entry must never push a new one back on, or it clobbers the entry it just popped, making
 * Ctrl+Z of an undo turn into a no-op loop instead of a redo. */
function useCanvasUndo(engineClient: ReturnType<typeof useEngineClient>): void {
  useEffect(() => {
    const onUndo = (event: Event) => {
      const detail = (event as CustomEvent<UndoEventDetail>).detail;
      if (detail.kind !== "canvas") return;
      applyCanvasPositions(engineClient, detail.layout);
    };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [engineClient]);
}

/**
 * The single canvas-document view (016-single-canvas-dashboard). Iterates every element and renders
 * it by its `render` key: `hierarchy` through HierarchyElement (which wraps the real strategy
 * renderer), `note` through NoteElement, `group` through GroupFrame (a background rect enclosing its
 * members' current bounds, not a box of its own), everything else (c1/pattern/impact/epic/custom)
 * through the one CanvasNodeBox. AgentRail's Diagrams tab is the one place to remove a diagram
 * outright or soft-remove it from the canvas (deleting its layer's elements/edges from the
 * document); a layer hidden via `collapsedLayersStore` (that same tab's collapse/expand) stays
 * fully on the document and is
 * just filtered out of `renderableElements` below, so re-expanding it needs no refetch.
 *
 * `Lane`/`Concurrency island` (054-diagram-flow-order) render as their own soft background areas
 * (`LaneArea`/`ConcurrencyIslandArea`) alongside `GroupFrame`'s real-group rectangle — but unlike
 * `group`, neither is a document element with a `render` key of its own: both are purely derived by
 * bucketing `renderableElements` on `meta.lane` / the leading digit of `meta.order`
 * (`memberIdsByLane`/`memberIdsByConcurrencyDigits` below), the same way `memberIdsByGroup` buckets
 * on `group_id`. A digit bucket with only one member never becomes an island (nothing to be
 * concurrent with), so it's dropped before rendering rather than showing a one-box "island".
 *
 * `DiagramFrame` draws one dashed frame per whole diagram (`memberIdsByLayer` below, bucketed on
 * `element.layer` the same way), also purely derived rather than a document element — but unlike the
 * other three background areas it is interactive: the frame itself is a drag handle that moves every
 * element on that layer together (its own component, not a fourth entry in the GroupFrame/LaneArea/
 * ConcurrencyIslandArea family, precisely because those three are deliberately non-interactive).
 *
 * Mounted unconditionally by RootCanvas as of Stage 4 — no InspectorPanel/rail/breadcrumb chrome
 * here, that all lives in RootCanvas and wraps this view the same way it wrapped the old six.
 */
export function CanvasDocView() {
  const engineClient = useEngineClient();
  useLoadCanvasDoc(engineClient);
  const doc = useCanvasDoc();
  const loaded = useCanvasDocLoaded();
  useCanvasUndo(engineClient);
  const customTypes = useCustomDiagramTypes(engineClient);

  const collapsedLayers = useCollapsedLayers();
  // Hides a collapsed diagram's elements from rendering only -- `doc.elements` itself is untouched,
  // so re-expanding needs no server round trip. `hierarchy`/`default` are never in `collapsedLayers`
  // (nothing ever collapses them -- see AgentRail's Diagrams tab, which only ever lists real diagram
  // layers), so this can stay a plain layer-membership filter with no special-cased layer names.
  const renderableElements = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(doc.elements).filter(([, element]) => !collapsedLayers.has(element.layer)),
      ),
    [doc.elements, collapsedLayers],
  );

  const visibleElements = useMemo(
    () => Object.values(renderableElements),
    [renderableElements],
  );

  // Real rendered box sizes, once each box's own ResizeObserver reports one — see CanvasEdges'
  // `sizes` prop and CanvasNodeBox's `onMeasure` for why routing needs this instead of `element.size`.
  const { sizes: measuredSizes, observe } = useMeasuredSizes();

  // The natural content height of each epics box (see epicsContentSizeStore) — feeds the once-post-
  // mount reflow below. It is measured off the box's own header element, which is not constrained by
  // `minHeight`, so an over-reserved box reports its true (shorter) content and can shrink.
  const contentSizes = useEpicsContentSizes();

  // Once-post-mount reflow: an epics box whose content height disagrees with its persisted size —
  // an underestimating card grows UP over the box above (epics boxes are bottom-left positioned with
  // minHeight + overflow), an over-reserving box leaves an empty dark band below. Re-fit the box to
  // its measured content height and persist the corrected size/position.
  useReflowEpics(engineClient, doc, contentSizes);
  useReflowSequence(engineClient, doc);

  const dragOffsets = useLiveDragOffsets();

  // CanvasEdges routes off each element's *persisted* position, which only updates once a drag's
  // own PATCH round trip resolves -- without folding the live offset in here too, an arrow stays
  // anchored to the pre-drag spot for the whole gesture and only jumps into place on drop.
  const visibleDoc = useMemo(() => {
    const elementIds = new Set(Object.keys(renderableElements));
    const elements = Object.fromEntries(
      Object.entries(renderableElements).map(([id, element]) => {
        const liveOffset = dragOffsets[id];
        if (!liveOffset) return [id, element];
        return [
          id,
          {
            ...element,
            position: {
              x: element.position.x + liveOffset.x,
              y: element.position.y + liveOffset.y,
            },
          },
        ];
      }),
    );
    // Drops an edge whose endpoint no longer exists -- either left behind by a partial batch, or
    // because one endpoint's diagram is currently collapsed (see `renderableElements` above), so a
    // collapsed diagram's edges vanish along with it for free.
    const edges = Object.fromEntries(
      Object.entries(doc.edges).filter(
        ([, edge]) => elementIds.has(edge.from) && elementIds.has(edge.to),
      ),
    );
    return { ...doc, elements, edges };
  }, [doc, renderableElements, dragOffsets]);

  // Which member ids belong to which group -- structural, so it's kept off `renderableElements`
  // (only changes on a real doc edit or layer toggle) rather than `visibleDoc.elements` (rebuilt on
  // every drag-offset tick, anywhere on the canvas). GroupFrame still needs live, drag-adjusted
  // positions for its own members, so that lookup happens per-group below, off `visibleDoc`.
  const memberIdsByGroup = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of Object.values(renderableElements)) {
      if (!element.group_id) continue;
      const ids = map.get(element.group_id);
      if (ids) ids.push(element.id);
      else map.set(element.group_id, [element.id]);
    }
    return map;
  }, [renderableElements]);

  // Lane/Concurrency island (054-diagram-flow-order) are derived purely from `meta.lane`/`meta.order`
  // -- unlike `group`, neither is a real document element, so there's no `render` kind to dispatch on;
  // this just buckets ids through `bucketPerLayer`, partitioned by diagram layer so a value shared by
  // boxes in *different* diagrams never collapses their areas into one spanning the whole canvas --
  // same layer-scoping `memberIdsByLayer` gives `DiagramFrame`. A digit run with only one member is
  // dropped (keepSingletons=false): a lone numbered step has nothing to be concurrent with.
  const laneBuckets = useMemo(
    () => bucketPerLayer(Object.values(renderableElements), (el) => stringMeta(el, "lane"), true),
    [renderableElements],
  );

  // Which elements belong to which diagram, for DiagramFrame's own whole-diagram frame+drag below --
  // structural like `memberIdsByGroup` (not rebuilt on every drag-offset tick), bucketed by
  // `element.layer` and filtered through the same deny-list `listActiveDiagramLayers` uses so the
  // seeded hierarchy tree and `apply_batch`'s fallback layer never grow a frame of their own.
  // `render: "group"` elements are excluded here specifically: GroupFrame computes ITS rect purely
  // from its own members (already counted directly, being on the same layer), never from the group
  // element's own `position` field -- that field is just wherever it happened to land when created
  // and is never touched again. Counting it too made DiagramFrame's union bounds balloon out to
  // whatever stale, off-to-one-side spot that field sat at, rendering a frame with a large dead zone
  // of empty space toward it instead of hugging the diagram's real content.
  const memberIdsByLayer = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of Object.values(renderableElements)) {
      if (!isDiagramLayer(element.layer) || BLOCK_RULES[element.render].renderer === "group") continue;
      const ids = map.get(element.layer);
      if (ids) ids.push(element.id);
      else map.set(element.layer, [element.id]);
    }
    return map;
  }, [renderableElements]);

  // Sequence layers render as one own-component per whole layer (SequenceDiagram), not per-element
  // boxes: every element with `render: "sequence"` is collected up (by its owning layer) so that
  // component can lay the participants/messages out from meta alone. Membership is whitellisted by
  // the render kind's own-component renderer, the same signal `memberIdsByLayer` filters `group` on.
  const sequenceMemberIdsByLayer = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of Object.values(renderableElements)) {
      if (BLOCK_RULES[element.render].renderer !== "sequence") continue;
      const ids = map.get(element.layer);
      if (ids) ids.push(element.id);
      else map.set(element.layer, [element.id]);
    }
    return map;
  }, [renderableElements]);

  const concurrencyBuckets = useMemo(
    () =>
      bucketPerLayer(
        Object.values(renderableElements),
        (el) => leadingOrderDigits(stringMeta(el, "order")),
        false,
      ),
    [renderableElements],
  );

  const bounds = useMemo(() => {
    const maxX = Math.max(
      0,
      ...visibleElements.map((element) => {
        const rect = elementRect(element, measuredSizes);
        return rect.left + rect.width;
      }),
    );
    const maxY = Math.max(
      0,
      ...visibleElements.map((element) => {
        const rect = elementRect(element, measuredSizes);
        return rect.top + rect.height;
      }),
    );
    return { width: maxX + CANVAS_MARGIN, height: maxY + CANVAS_MARGIN };
  }, [visibleElements, measuredSizes]);

  return (
    <div className="canvas-doc-view" data-testid="canvas-doc-view">
      {loaded && (
        <>
          <DiagramRelationshipsSvg kind="canvas-doc" width={bounds.width} height={bounds.height}>
            <CanvasEdges
              doc={visibleDoc}
              sizes={measuredSizes}
              onOpenOrigin={(origin) => void openOrigin(origin, engineClient)}
            />
          </DiagramRelationshipsSvg>
          {[...memberIdsByLayer.entries()].map(([layer, memberIds]) => (
            <DiagramFrame
              key={`diagram-${layer}`}
              layer={layer}
              label={labelForDiagramLayer(layer, customTypes)}
              members={resolveMembers(memberIds, visibleDoc.elements)}
              sizes={measuredSizes}
            />
          ))}
          {laneBuckets.map(({ layer, value, ids }) => (
            <LaneArea
              key={`lane-${layer}-${value}`}
              lane={value}
              members={resolveMembers(ids, visibleDoc.elements)}
              sizes={measuredSizes}
            />
          ))}
          {concurrencyBuckets.map(({ layer, value, ids }) => (
            <ConcurrencyIslandArea
              key={`island-${layer}-${value}`}
              digits={value}
              members={resolveMembers(ids, visibleDoc.elements)}
              sizes={measuredSizes}
            />
          ))}
          {[...sequenceMemberIdsByLayer.entries()].map(([layer, memberIds]) => (
            <SequenceDiagram
              key={`sequence-${layer}`}
              layer={layer}
              elements={resolveMembers(memberIds, visibleDoc.elements)}
            />
          ))}
          {visibleElements.map((element) => {
            switch (BLOCK_RULES[element.render].renderer) {
              case "hierarchy":
                // Retired code-tree block: an old document may still carry one; it draws nothing.
                return null;
              case "note":
                return <NoteElement key={element.id} element={element} />;
              case "group":
                // `.canvas-group-frame`'s own z-index (0, below every box's 1) is what keeps it
                // behind its members -- not DOM order -- so this needs no separate earlier pass.
                {
                  const members = resolveMembers(memberIdsByGroup.get(element.id) ?? [], visibleDoc.elements);
                  return (
                    <GroupFrame key={element.id} element={element} members={members} sizes={measuredSizes} />
                  );
                }
              case "sequence":
                // A `sequence` layer's members render through the per-layer SequenceDiagram above,
                // never here as individual boxes.
                return null;
              default:
                return <CanvasNodeBox key={element.id} element={element} onMeasure={observe} />;
            }
          })}
        </>
      )}
    </div>
  );
}
