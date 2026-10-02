import { useCallback, useEffect, useRef } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { elementDragPointerDown, useDragOffset, type Offset } from "../useDragOffset";
import { useGroupDrag } from "../collision/useGroupDrag";
import { inspectorStore, useIsInspectorTarget } from "../inspectorStore";
import { selectionStore } from "../../state/selectionStore";
import { useIsSelected, useSelectedCount } from "../../state/selectionStore";
import { canvasDocStore, commitCanvasPositions } from "./canvasDocStore";
import { dragOffsetStore, useLiveDragOffsets } from "./dragOffsetStore";
import { epicBriefPanelStore } from "./epicBriefPanelStore";
import { NODE_STYLES, type StyledRenderKind } from "./nodeStyles";
import { descriptionPopupStore } from "./descriptionPopupStore";
import { accentFor, ImpactStatusChip, OrderBadge, PlanKindChip } from "./nodeAccent";
import { stringMeta } from "./elementMeta";
import { CopyButton, NodeChangeBadge } from "../strategies/nodeChrome";
import { elementCopyText } from "../strategies/nodeCopyText";
import { useNodeOverlays } from "../../state/useSidecar";
import { authoredStyle } from "../authoredStyle";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";

function styleFor(render: CanvasElement["render"]) {
  return NODE_STYLES[render as StyledRenderKind] ?? NODE_STYLES.custom;
}

export interface CanvasNodeBoxProps {
  element: CanvasElement;
  /** Reports this box's real rendered DOM node, keyed by element id — CanvasDocView feeds it into
   * useMeasuredSizes so CanvasEdges can route off the box's actual footprint instead of `element.size`
   * (a box only ever grows right/down past that default: its own `left`/`top` below are pinned by the
   * *assumed* size, so a taller/wider box never moves, it just outgrows the rect routing assumed —
   * which is exactly what let an arrow/label land on a box with more content than the default). */
  onMeasure?: (id: string, node: HTMLElement | null) => void;
}

/**
 * One recipe-authored box (c1/pattern/impact/epic/custom/group) on the one canvas — replaces the
 * five near-identical `*NodeBox` components with one, styled per `render` kind via nodeStyles.tsx.
 * Reuses useDragOffset directly (not the collision/multi-select system the older views' boxes use):
 * a canvas-doc element's position is the document's own truth, committed straight through
 * `update_element`, so there's no separate saved-layout store to reconcile against.
 */
export function CanvasNodeBox({ element, onMeasure }: CanvasNodeBoxProps) {
  const engineClient = useEngineClient();
  const measureRef = useCallback(
    (node: HTMLElement | null) => onMeasure?.(element.id, node),
    [onMeasure, element.id],
  );
  const isSelected = useIsSelected(element.id);
  // Passing this box's own `element.id` alongside its `node_id` matters here specifically: an
  // activity/process diagram (054-diagram-flow-order) can draw one code entity as several boxes at
  // different steps, all sharing one `node_id` -- without the box id, clicking any one of them lit
  // up every box for that entity instead of just the one clicked.
  const isInspectorTarget = useIsInspectorTarget(element.node_id ?? element.id, element.id);
  const style = styleFor(element.render);
  const accent = accentFor(element);
  const width = element.size?.w ?? DEFAULT_ELEMENT_SIZE.w;
  const height = element.size?.h ?? DEFAULT_ELEMENT_SIZE.h;
  // A permanently-empty store unless an Impact layer is present and Diff mode is on (see
  // useC1DiffSync) — a cheap, harmless subscription the rest of the time.
  const { isImpact, change: impactChange } = useNodeOverlays(element);

  const selectedCount = useSelectedCount();
  // Miro-style: 2+ boxes selected and this is one of them means dragging it moves the whole group,
  // same threshold useSelectionAwareDrag uses for the hierarchy's own top-level boxes. Below that,
  // this is a plain solo drag exactly like before.
  const isGroupDrag = isSelected && selectedCount > 1;
  const liveDragOffsets = useLiveDragOffsets();

  // Commits one or several boxes' new positions in a single PATCH -- `commitCanvasPositions`
  // (canvasDocStore.ts) is the one shared write/rollback + "canvas" undo-recording shape, also used
  // by DiagramFrame's whole-diagram drag, so neither commit path needs its own undoStore call.
  const commitPositions = (positions: Record<string, Offset>) => commitCanvasPositions(engineClient, positions);

  const solo = useDragOffset({
    suppressClickAfterDrag: true,
    onPreview: (liveOffset) => dragOffsetStore.set(element.id, liveOffset),
    onEnd: (dragOffset) => {
      dragOffsetStore.clear(element.id);
      const prior = element.position;
      const next = { x: prior.x + dragOffset.x, y: prior.y + dragOffset.y };
      // The delta is folded straight into canvasDocStore's own position, so the local hook offset
      // must go back to zero right away -- otherwise it double-counts on top of `next` on every
      // render until this component remounts (the bug a page refresh used to "fix").
      solo.resetOffset?.();
      commitPositions({ [element.id]: next });
    },
  });

  // Every id this box's own group-drag handle has pushed a live offset for -- so if THIS box (the
  // handle) unmounts mid-gesture (e.g. it or its diagram gets deleted by another window/agent while
  // being dragged), the unmount effect below can still clear every id the aborted drag touched,
  // including passive members other than this box. onGroupCommit deletes an id the instant it clears
  // the store for it, so only a genuinely still-in-flight id is left by the time unmount runs.
  const trackedGroupIdsRef = useRef<Set<string>>(new Set());

  // A free group move -- every selected box gets the same pointer delta, no collision solving --
  // deliberately the opposite of the hierarchy's own solo-drag settle-beside-a-neighbour behavior,
  // and there's no equivalent here anyway: a canvas-doc element's position is the document's own
  // absolute truth (see the module doc comment), so a group drag just moves every selected id's
  // position by the same amount and commits them all in one batch.
  const group = useGroupDrag({
    enabled: isGroupDrag,
    suppressClickAfterDrag: true,
    selectedIds: () => {
      const doc = canvasDocStore.getDoc();
      return selectionStore.getSelectedIds().filter((id) => doc.elements[id]);
    },
    getOffset: (id) => liveDragOffsets[id] ?? { x: 0, y: 0 },
    onGroupPreview: (offsets) => {
      // Batched (see dragOffsetStore.setMany / DiagramFrame's identical fix) -- a per-id `set` loop
      // here fanned out into one full-canvas re-render broadcast per selected box, per frame.
      dragOffsetStore.setMany(offsets);
      for (const id of Object.keys(offsets)) trackedGroupIdsRef.current.add(id);
    },
    onGroupCommit: (offsets) => {
      const doc = canvasDocStore.getDoc();
      const positions: Record<string, Offset> = {};
      for (const [id, boxOffset] of Object.entries(offsets)) {
        const el = doc.elements[id];
        if (!el) continue;
        positions[id] = { x: el.position.x + boxOffset.x, y: el.position.y + boxOffset.y };
        dragOffsetStore.clear(id);
        trackedGroupIdsRef.current.delete(id);
      }
      commitPositions(positions);
      selectionStore.clear();
    },
  });

  // Runs once, only on true unmount -- clears this box's own solo offset (harmless no-op if it was
  // never set) plus every id a group drag this box's handle started never got to commit, so an
  // aborted gesture never leaves a box rendering permanently offset from its real position.
  useEffect(() => {
    return () => {
      dragOffsetStore.clear(element.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a mutable id Set, not a DOM node ref
      for (const id of trackedGroupIdsRef.current) dragOffsetStore.clear(id);
    };
  }, [element.id]);

  const active = isGroupDrag ? group : solo;
  const { offset, isDragging, handleProps } = active;
  // A passive group member (selected, but not the box the pointer is actually on) never gets its
  // own pointer events, so its own `offset` above never changes -- the group's delta reaches it only
  // through `onGroupPreview` pushing a live value into dragOffsetStore, mirroring
  // useSelectionAwareDrag's identical reconciliation for the hierarchy's own top-level boxes. Once a
  // gesture commits, canvasDocStore's own `element.position` already carries the delta and the live
  // offset is cleared, so idle boxes render from `element.position` alone again.
  //
  // The idle (not dragging) fallback must NOT read `offset` while `isGroupDrag` is true: `group`'s
  // own internal useDragOffset offset only ever moves while THIS box is itself the live drag handle,
  // and its `onGroupCommit` (above) never zeroes it back out afterward (unlike solo's own explicit
  // `resetOffset()` at commit). A box that was once a group-drag handle keeps that leftover, nonzero
  // offset sitting in its own hook state forever after -- invisible while deselected (isGroupDrag
  // false routes through `solo`, whose own offset genuinely is always reset), but the instant this
  // box is selected again as part of a 2+ group -- whether or not a new drag ever starts, and even
  // if THIS box is only ever a passive member of someone else's drag from here on -- `active` flips
  // back to `group` and that stale value would silently resurface the moment dragOffsetStore has no
  // live entry for it (e.g. right after any group member's commit clears every participant's entry).
  // Zero is always the right idle answer for a group member: a real in-progress drag is already
  // covered by the `isDragging` branch below, which reads the live, cross-box dragOffsetStore instead
  // of this box's own local state.
  const renderOffset = isDragging
    ? isGroupDrag
      ? (liveDragOffsets[element.id] ?? { x: 0, y: 0 })
      : offset
    : (liveDragOffsets[element.id] ?? (isGroupDrag ? { x: 0, y: 0 } : offset));

  // Shared by the click and keyboard (Enter/Space) activation paths -- a box must be operable
  // without a mouse, not just focusable (WCAG 2.1.1).
  const activate = (toggleSelection: boolean, event: { stopPropagation: () => void }) => {
    if (toggleSelection) {
      event.stopPropagation();
      selectionStore.toggle(element.id);
      return;
    }
    selectionStore.clear();
    if (element.render === "epic") {
      const itemId = element.meta.recipe_key;
      if (typeof itemId === "string") epicBriefPanelStore.open(itemId);
      return;
    }
    // A Planned block's add/create role (055-diagram-feature-plan) has no real code behind it --
    // InspectorPanel would otherwise open and report it "no longer exists", the wrong message for
    // something that never existed yet. Route to the description popup instead, same as the "?"
    // button below. modify/delete point at real, already-existing code, so they fall through to the
    // normal Inspector path unchanged.
    const planKind = stringMeta(element, "plan_kind");
    if (planKind === "add" || planKind === "create") {
      descriptionPopupStore.open(element.label, stringMeta(element, "details") ?? element.description ?? "");
      return;
    }
    // Always opens the panel, even without a resolved node_id (a c1 System/Actor box, a Patterns
    // infra node, or a block whose authored path went stale never gets one) -- InspectorPanel's own
    // useInspectorNode already turns a real "no such node" answer into a clear "no longer exists /
    // the diagram may be out of date" message with Retry, instead of this leaving the click looking
    // like it silently did nothing.
    // Re-clicking the box already open in the inspector closes it instead of reopening the same page.
    if (isInspectorTarget) {
      inspectorStore.close();
      return;
    }
    inspectorStore.open(element.node_id ?? element.id, element.label, element.id);
  };

  const classes = [
    style.boxClass,
    isDragging ? style.draggingClass : "",
    isSelected ? "block-selected" : "",
    isInspectorTarget ? "block-inspector-target" : "",
    impactChange ? `block-change--${impactChange.status}` : "",
    accent.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const titleAndDesc = (
    <>
      <div className={style.titleRowClass}>
        {accent.icon}
        <span className={style.nameClass} title={element.label}>
          {element.label}
        </span>
        {isImpact && <NodeChangeBadge change={impactChange} />}
      </div>
      {style.descClass && element.description && (
        <span className={style.descClass} data-testid="canvas-node-box-description">
          {element.description}
        </span>
      )}
    </>
  );

  return (
    <div
      ref={measureRef}
      className={classes}
      data-testid="canvas-node-box"
      data-node-id={element.node_id ?? undefined}
      // The marquee's own lookup key (CanvasViewport.tsx) -- selectionStore/useIsSelected key this
      // box by its own canvas-doc id, not `data-node-id` (the engine node id used for focus/fit,
      // absent entirely for a synthetic C1 System/Actor box) -- a marquee matching on that instead
      // used to add the wrong id, or nothing at all, so nothing ever lit up as selected.
      data-select-id={element.id}
      data-render={element.render}
      style={{
        position: "absolute",
        left: element.position.x - width / 2 + renderOffset.x,
        top: element.position.y - height / 2 + renderOffset.y,
        // A fixed `width` (not `minWidth`) is load-bearing: this box has no CSS width of its own
        // (only the shared `.block`'s min-width floor), so without it the box shrink-to-fits
        // against `.canvas-content`'s own auto-computed extent -- which is unconstrained once a box
        // sits far from every neighbor, so it grows wider and wider until its description resolves
        // onto one line. Pinning `width` here stops that; `minHeight` stays a floor so the box can
        // still grow taller for a longer description, capped by the line-clamp in styles.css.
        width,
        minHeight: height,
        ...authoredStyle(element.style),
      }}
      {...handleProps}
      onPointerDown={elementDragPointerDown(handleProps)}
    >
      <PlanKindChip element={element} />
      <ImpactStatusChip element={element} />
      <OrderBadge element={element} />
      <div className={style.rowClass} data-testid="canvas-node-box-row">
        <div
          className={style.headerClass}
          data-testid="canvas-node-box-header"
          role="button"
          tabIndex={0}
          onClick={(event) => activate(event.shiftKey || event.metaKey || event.ctrlKey, event)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            activate(event.shiftKey || event.metaKey || event.ctrlKey, event);
          }}
        >
          {/* headerClass itself lays its direct children out in a row (title column beside the
              copy/desc buttons, mirroring Block.tsx) -- without this wrapper the name-row and
              description would sit side by side as two more row items instead of stacking. */}
          <div className={style.titleWrapClass}>{titleAndDesc}</div>
          <div className="canvas-node-box-buttons" data-testid="canvas-node-box-buttons">
            <CopyButton
              text={elementCopyText(element.node_id, element.label)}
              name={element.label}
              variant="canvas-node-box"
            />
            {style.descClass && element.description && (
              <button
                type="button"
                className="canvas-node-box-desc-button"
                aria-label={`Show full description for ${element.label}`}
                title="Show full description"
                data-testid="canvas-node-box-desc-button"
                onClick={(event) => {
                  // The name-row/description sit inside the same clickable header, which otherwise
                  // opens the InspectorPanel (`activate`, above) — this button is a separate escape
                  // hatch for the description text alone, so it must not also trigger that.
                  event.stopPropagation();
                  descriptionPopupStore.open(element.label, element.description ?? "");
                }}
              >
                ?
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
