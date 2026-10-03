import { useCallback, useEffect, useRef } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { elementDragPointerDown, type Offset } from "../useDragOffset";
import { useGroupDrag } from "../collision/useGroupDrag";
import { useCollisionAvoidance } from "../collision/useCollisionAvoidance";
import { useCollisionParticipant } from "../collision/collisionStore";
import { DropGhost } from "../collision/DropGhost";
import { inspectorStore, useIsInspectorTarget } from "../inspectorStore";
import { selectionStore } from "../../state/selectionStore";
import { useIsSelected, useSelectedCount } from "../../state/selectionStore";
import { canvasDocStore, commitCanvasPositions } from "./canvasDocStore";
import { dragOffsetStore, useLiveDragOffsets } from "./dragOffsetStore";
import { NODE_STYLES, type StyledRenderKind } from "./elementRules";
import { descriptionPopupStore } from "./descriptionPopupStore";
import { accentFor, noCodeReasonMessage } from "./nodeAccentLogic";
import { NodeMetaRow, NodeTopBand } from "./nodeAccent";
import { BLOCK_RULES } from "./elementRules";
import { stringMeta } from "./elementMeta";
import { epicsContentSizeStore } from "./epicsContentSizeStore";
import { isAcceptance, isContentCard, isEpicsLayerName, isSpecs, isSummary, linesOf } from "./epicsLayout";
import { specStories } from "./specStories";
import { CopyButton, NodeChangeBadge } from "../strategies/nodeChrome";
import { elementCopyText } from "../strategies/nodeCopyText";
import { useNodeOverlays } from "../../state/useSidecar";
import { authoredStyle } from "../authoredStyle";
import { BOTTOM_LEFT_RENDERS, DEFAULT_ELEMENT_SIZE } from "./elementRect";

function styleFor(render: CanvasElement["render"]) {
  return NODE_STYLES[render as StyledRenderKind] ?? NODE_STYLES.custom;
}

/** The drag state a locked-layout box (epic tree) substitutes for `solo`/`group` — a static zero
 * offset and a no-op pointer handler. Hoisted to module scope so a locked box never allocates a new
 * object or arrow per render; it just reads a drag that can never start. `handleProps` stays a real
 * object so CanvasNodeBox's `onPointerDown` guard still spreads it. */
const LOCKED_ACTIVE = { offset: { x: 0, y: 0 }, isDragging: false, handleProps: { onPointerDown: () => {} } };

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
 * five near-identical `*NodeBox` components with one, styled per `render` kind via elementRules.ts.
 * Reuses useDragOffset directly (not the collision/multi-select system the older views' boxes use):
 * a canvas-doc element's position is the document's own truth, committed straight through
 * `update_element`, so there's no separate saved-layout store to reconcile against.
 */
export function CanvasNodeBox({ element, onMeasure }: CanvasNodeBoxProps) {
  const engineClient = useEngineClient();
  // Stable ref to this box's real DOM node — feeds both `onMeasure` (CanvasDocView's measurement for
  // arrow routing) and the collision participant registry (whose rects are read live off the DOM).
  const rootRef = useRef<HTMLElement | null>(null);
  const measureRef = useCallback(
    (node: HTMLElement | null) => {
      rootRef.current = node;
      onMeasure?.(element.id, node);
    },
    [onMeasure, element.id],
  );
  const isSelected = useIsSelected(element.id);
  // The box's header element (name + meta + description) -- its natural content height drives the
  // epics reflow's shrink/grow decision (epicsContentSizeStore). The box border-box can't: its
  // `minHeight` is forced to the reserved `size.h`, so an over-reserved box always reports exactly
  // the reservation even when its text is shorter, hiding the empty dark band. The header has no
  // such constraint, so its height is the honest footprint.
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Report this box's real content height once measured (and on every resize) for epics boxes only --
  // other layers have no reflow consumer, so reporting them just churns the store.
  useEffect(() => {
    if (!isEpicsLayerName(element.layer)) return;
    const header = headerRef.current;
    if (!header) return;
    const report = () => epicsContentSizeStore.set(element.id, Math.round(header.offsetHeight));
    report();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(report);
      ro.observe(header);
    }
    return () => {
      ro?.disconnect();
      epicsContentSizeStore.clear(element.id);
    };
  }, [element.id, element.layer]);
  // Passing this box's own `element.id` alongside its `node_id` matters here specifically: an
  // activity/process diagram (054-diagram-flow-order) can draw one code entity as several boxes at
  // different steps, all sharing one `node_id` -- without the box id, clicking any one of them lit
  // up every box for that entity instead of just the one clicked.
  const isInspectorTarget = useIsInspectorTarget(element.node_id ?? element.id, element.id);
  const style = styleFor(element.render);
  // Hard layout (010-epics-tree-render, Part 4): an epic-tree box sits in a pre-structured parent
  // frame, so it is never user-draggable — no solo/group drag, no collision solving, no position
  // writes. Its position comes only from auto-layout / the fit loop. Discrete — everything else
  // stays freely draggable as before.
  const lockedLayout = Boolean(BLOCK_RULES[element.render].lockedLayout);
  const accent = accentFor(element);
  const width = element.size?.w ?? DEFAULT_ELEMENT_SIZE.w;
  const height = element.size?.h ?? DEFAULT_ELEMENT_SIZE.h;
  // A content card (Summary prose / Acceptance list / Спеки stories) auto-fits to its text; an epic
  // render that is NOT one is the column's structural header (the epic title box).
  const isEpicRoot = element.render === "epic" && !isContentCard(element);
  // A Summary prose card (authored `meta.summary`) renders unclamped and wide, distinct from the
  // epic title box above it in the same column.
  const isSummaryCard = isSummary(element);
  // An Acceptance-criteria box splits its `\n`-separated description into distinct rows (no
  // checkboxes, matching the epic brief's structural card) instead of one run-on paragraph.
  const isAcc = isAcceptance(element);
  // A «Спеки» (User Stories) box renders each `US# · … (P# · …)` story with its why line and a
  // numbered criteria list -- the epic brief's specs card, no checkboxes, mirroring the acceptance
  // convention but one level deeper (each story is its own small card). Both predicates are
  // epicsLayout.ts's own, so a card kind is named in one place.
  const isSpecsCard = isSpecs(element);
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

  const solo = useCollisionAvoidance({
    id: element.id,
    suppressClickAfterDrag: true,
    enabled: !isGroupDrag && !lockedLayout,
    onLiveOffset: (liveOffset) => dragOffsetStore.set(element.id, liveOffset),
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

  // Register this box as a collision obstacle (and as the moving block) for the solo drag's
  // settle-beside-a-neighbour solving. Idle/group drags skip it: a group move stays free, and an
  // idle box isn't an obstacle anyone else needs to respect mid-gesture only if it also participates.
  // A locked-layout box registers as neither obstacle nor mover -- it never takes part in solving.
  useCollisionParticipant(element.id, rootRef, !isGroupDrag && !lockedLayout);

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
    enabled: isGroupDrag && !lockedLayout,
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

  // A locked-layout box never drags: `solo`/`group` are both disabled above, and this substitutes a
  // static DragOffset so the rest of the component (renderOffset, handleProps spread, the ghost
  // drop) needs no per-branch reasoning about "am I locked" -- it just reads a drag that can never
  // start. `handleProps` stays a real object so CanvasNodeBox's `onPointerDown` guard still spreads.
  const active = lockedLayout ? LOCKED_ACTIVE : isGroupDrag ? group : solo;
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
    // An epics-layer box (epic title, content card, phase header or task) has no code behind it --
    // its primary click opens the SAME right-side inspector as a code box, showing the block's full
    // text + its place in the epic instead of a code tree. Opening the inspector keeps re-clicking
    // the already-open box closing it, matching the code-box behavior below.
    if (isEpicsLayerName(element.layer)) {
      if (isInspectorTarget) {
        inspectorStore.close();
        return;
      }
      inspectorStore.open(element.id, element.label, element.id, undefined, {
        element,
        doc: canvasDocStore.getDoc(),
      });
      return;
    }
    // An epic/story box's primary click opens the right-side inspector showing the work item's full
    // text (010-epics-tree-render Part 5). The AI brief is reached from a button inside that level.
    // `stringMeta` restores the runtime type guard (`meta` is `Record<string, unknown>`) — the
    // epic-brief rule always stamps a string key, and the `openId` fallback chain tolerates undefined.
    // A spec box (the epic brief's spec/user-story node) has no work item of its own: its stages
    // live on the epic, so the click resolves to the epic id carried in `meta.spec_of`.
    const isEpicBrief = BLOCK_RULES[element.render].activation === "epic-brief";
    const workItemId = isEpicBrief
      ? (stringMeta(element, "spec_of") ?? stringMeta(element, "recipe_key"))
      : undefined;
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
    // A box the resolver stamped with `meta.no_code_reason` (diagram_resolver.py) has no real code
    // behind it -- conceptual (no path ever authored) or unresolved (an authored path that failed) --
    // so it opens the same description popup as a Planned block, with a reason-specific message,
    // instead of InspectorPanel's generic "no longer exists" (the wrong message for something that
    // was never real code, or for an authoring mistake it has no way to explain).
    const noCodeReason = stringMeta(element, "no_code_reason");
    if (noCodeReason === "conceptual" || noCodeReason === "unresolved") {
      descriptionPopupStore.open(element.label, noCodeReasonMessage(element, noCodeReason));
      return;
    }
    // Falls through to the Inspector for a real, resolved node_id -- InspectorPanel's own
    // useInspectorNode still turns a genuine "no such node" into a clear message with Retry. For a
    // work item the id is the recipe key (an epic box has no node_id). Re-clicking the box already
    // open in the inspector closes it instead of reopening the same page.
    const openId = workItemId ?? element.node_id ?? element.id;
    if (isInspectorTarget) {
      inspectorStore.close();
      return;
    }
    inspectorStore.open(openId, element.label, element.id, workItemId);
  };

  const classes = [
    style.boxClass,
    isDragging ? style.draggingClass : "",
    isSelected ? "block-selected" : "",
    isInspectorTarget ? "block-inspector-target" : "",
    impactChange ? `block-change--${impactChange.status}` : "",
    accent.className ?? "",
    // An epics-layer box (epic title, or a Summary/Acceptance/Спеки content card) carries a shared
    // marker so its title rows can be styled more prominently than a generic diagram box.
    BOTTOM_LEFT_RENDERS.has(element.render) ? "diagram-node-box--epic" : "",
    // The epic title box itself (render "epic", NOT a content card) is the column's structural header.
    isEpicRoot ? "diagram-node-box--epic-root" : "",
    isSummaryCard ? "diagram-node-box--summary" : "",
    // An Acceptance-criteria block (authored `spec_of` + a `\n`-separated description) shows its full
    // text as preserved lines -- no clamp, no collapsing -- exactly like the Summary card does, so
    // the criteria list is never truncated or run together.
    isAcc ? "diagram-node-box--acceptance" : "",
    // A «Спеки» (User Stories) block renders each story card (overriding the acceptance structure) --
    // see the `isSpecsCard` description branch below.
    isSpecsCard ? "diagram-node-box--specs" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Impact count for the meta-row chip (`useNodeOverlays` also powers `NodeChangeBadge` above) --
  // the box's own attributed change count, echoed as `· N` to mirror the form's `~ MODIFY · 17`.
  const impactCount = impactChange?.change_count ?? 0;

  return (
    <>
    <div
      ref={measureRef}
      className={classes}
      data-testid="canvas-node-box"
      data-canvas-element
      data-node-id={element.node_id ?? undefined}
      // The marquee's own lookup key (CanvasViewport.tsx) -- selectionStore/useIsSelected key this
      // box by its own canvas-doc id, not `data-node-id` (the engine node id used for focus/fit,
      // absent entirely for a synthetic C1 System/Actor box) -- a marquee matching on that instead
      // used to add the wrong id, or nothing at all, so nothing ever lit up as selected.
      data-select-id={element.id}
      data-render={element.render}
      style={{
        position: "absolute",
        // An epics box (`epic`/`spec`/`task`) positions by its bottom-left corner (`left = x`,
        // `top = y - height`), matching elementRect; every other box centers on `position`.
        ...(BOTTOM_LEFT_RENDERS.has(element.render)
          ? { left: element.position.x + renderOffset.x, top: element.position.y - height + renderOffset.y }
          : { left: element.position.x - width / 2 + renderOffset.x, top: element.position.y - height / 2 + renderOffset.y }),
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
      <NodeTopBand element={element} />
      <div className={style.rowClass} data-testid="canvas-node-box-row">
        <div
          ref={headerRef}
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
              copy/desc buttons, mirroring Block.tsx) -- without this wrapper the name-row, the meta
              row's chips and the description would sit side by side as more row items instead of
              stacking. */}
          <div className={style.titleWrapClass}>
            <NodeMetaRow element={element} count={impactCount} />
            <div className={style.titleRowClass}>
              {accent.icon}
              <span className={style.nameClass} title={element.label}>
                {element.label}
              </span>
              {isImpact && <NodeChangeBadge change={impactChange} />}
            </div>
            {style.descClass && element.description && isSpecsCard && (
              <div className={style.descClass + " diagram-node-box-stories"} data-testid="canvas-node-box-description">
                {specStories(element.description).map((story, i) =>
                  story.intro ? (
                    <p className="diagram-node-box-stories-intro" key={i}>
                      {story.intro}
                    </p>
                  ) : (
                    <div className="diagram-node-box-story" key={i}>
                      <div className="diagram-node-box-story-head">
                        <span className="diagram-node-box-story-name">{story.title}</span>
                        {story.priority && <span className="diagram-node-box-story-prio">{story.priority}</span>}
                      </div>
                      {story.why && <p className="diagram-node-box-story-why">{story.why}</p>}
                      {story.criteria.length > 0 && (
                        <ol className="diagram-node-box-story-criteria">
                          {story.criteria.map((c, j) => (
                            <li key={j}>{c}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
            {style.descClass && element.description && !isSpecsCard && isAcc && (
              <ul className={style.descClass + " diagram-node-box-criteria"} data-testid="canvas-node-box-description">
                {linesOf(element.description).map((line, i) => (
                    <li key={i}>
                      <span className="diagram-node-box-criteria-mark" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
              </ul>
            )}
            {style.descClass && element.render === "task" && element.description && (
              <span className={style.descClass + " diagram-node-box-task"} data-testid="canvas-node-box-description">
                <span className="diagram-node-box-task-tags">
                  {stringMeta(element, "parallel") && <span className="task-tag task-tag--p">P</span>}
                  {stringMeta(element, "us") && <span className="task-tag task-tag--us">{stringMeta(element, "us")}</span>}
                </span>
                <span className="diagram-node-box-task-text">{element.description}</span>
              </span>
            )}
            {style.descClass && element.description && !isSpecsCard && !isAcc && element.render !== "task" && (
              <span className={style.descClass} data-testid="canvas-node-box-description">
                {element.description}
              </span>
            )}
          </div>
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
    {/* The landing outline for the solo drag's collision-solving — null while not dragging or during
        a group move (whose `active` switches to `group`, and loses the ghost by design). */}
    {!isGroupDrag ? <DropGhost ghost={solo.ghost} /> : null}
    </>
  );
}
