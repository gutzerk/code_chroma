import { useEffect, useMemo } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { DiagramRelationshipsSvg } from "../DiagramSurface";
import { useMeasuredSizes } from "../useMeasuredSizes";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasNodeBox } from "./CanvasNodeBox";
import { ConcurrencyIslandArea } from "./ConcurrencyIslandArea";
import { DiagramFrame } from "./DiagramFrame";
import { isDiagramLayer, labelForDiagramLayer, useCustomDiagramTypes } from "./diagramCatalog";
import { elementRect } from "./elementRect";
import { leadingOrderDigits, stringMeta } from "./elementMeta";
import { GroupFrame } from "./GroupFrame";
import { HierarchyElement } from "./HierarchyElement";
import { LaneArea } from "./LaneArea";
import { NoteElement } from "./NoteElement";
import {
  applyCanvasPositions,
  useCanvasDoc,
  useCanvasDocLoaded,
  useLoadCanvasDoc,
} from "./canvasDocStore";
import { useCollapsedLayers } from "./collapsedLayersStore";
import { useLiveDragOffsets } from "./dragOffsetStore";
import { UNDO_EVENT, type UndoEventDetail } from "../UndoManager";

const CANVAS_MARGIN = 400;

export interface CanvasDocViewProps {
  /** Fallback for an element whose own `meta.strategy` is unset — RootCanvas's resolved `?strategy=`
   * / VITE_CANVAS_STRATEGY. The seeded root block carries no strategy of its own (the server writes
   * it, and the render choice is a client-side, per-page-load concern), so this is what picks the
   * renderer for it. An element that does carry one still wins. */
  strategyName?: string;
}

/** Resolves a group/Lane/Concurrency-island's member ids against `visibleDoc`'s live-drag-adjusted
 * elements, dropping any id no longer present -- shared by all three area renderers below so a
 * member removed mid-drag (or never resolved in the first place) can't leave a `undefined` in the
 * list any of them hands to `unionBoundsOf`. */
function resolveMembers(ids: readonly string[], elements: Record<string, CanvasElement>): CanvasElement[] {
  return ids
    .map((id) => elements[id])
    .filter((member): member is CanvasElement => member !== undefined);
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
export function CanvasDocView({ strategyName }: CanvasDocViewProps) {
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
  // this just buckets ids off the same structural pass `memberIdsByGroup` uses. A digit run with only
  // one member isn't dropped as "empty" -- it just never formed a group in the first place, since a
  // lone numbered step has nothing to be concurrent with.
  const memberIdsByLane = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of Object.values(renderableElements)) {
      const lane = stringMeta(element, "lane");
      if (!lane) continue;
      const ids = map.get(lane);
      if (ids) ids.push(element.id);
      else map.set(lane, [element.id]);
    }
    return map;
  }, [renderableElements]);

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
      if (!isDiagramLayer(element.layer) || element.render === "group") continue;
      const ids = map.get(element.layer);
      if (ids) ids.push(element.id);
      else map.set(element.layer, [element.id]);
    }
    return map;
  }, [renderableElements]);

  const memberIdsByConcurrencyDigits = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of Object.values(renderableElements)) {
      const digits = leadingOrderDigits(stringMeta(element, "order"));
      if (digits === undefined) continue;
      const ids = map.get(digits);
      if (ids) ids.push(element.id);
      else map.set(digits, [element.id]);
    }
    for (const [digits, ids] of map) {
      if (ids.length < 2) map.delete(digits);
    }
    return map;
  }, [renderableElements]);

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
            <CanvasEdges doc={visibleDoc} sizes={measuredSizes} />
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
          {[...memberIdsByLane.entries()].map(([lane, memberIds]) => (
            <LaneArea
              key={`lane-${lane}`}
              lane={lane}
              members={resolveMembers(memberIds, visibleDoc.elements)}
              sizes={measuredSizes}
            />
          ))}
          {[...memberIdsByConcurrencyDigits.entries()].map(([digits, memberIds]) => (
            <ConcurrencyIslandArea
              key={`island-${digits}`}
              digits={digits}
              members={resolveMembers(memberIds, visibleDoc.elements)}
              sizes={measuredSizes}
            />
          ))}
          {visibleElements.map((element) => {
            if (element.render === "hierarchy") {
              return (
                <HierarchyElement
                  key={element.id}
                  element={element}
                  fallbackStrategy={strategyName}
                />
              );
            }
            if (element.render === "note") {
              return <NoteElement key={element.id} element={element} />;
            }
            if (element.render === "group") {
              // `.canvas-group-frame`'s own z-index (0, below every box's 1) is what keeps it
              // behind its members -- not DOM order -- so this needs no separate earlier pass.
              const members = resolveMembers(memberIdsByGroup.get(element.id) ?? [], visibleDoc.elements);
              return (
                <GroupFrame key={element.id} element={element} members={members} sizes={measuredSizes} />
              );
            }
            return <CanvasNodeBox key={element.id} element={element} onMeasure={observe} />;
          })}
        </>
      )}
    </div>
  );
}
