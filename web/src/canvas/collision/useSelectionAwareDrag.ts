import { useCallback, useEffect, useRef, type RefObject } from "react";
import { selectionStore, useIsSelected, useSelectedCount } from "../../state/selectionStore";
import type { DragHandleProps, Offset } from "../useDragOffset";
import { useCollisionAvoidance, type DropGhostGeometry } from "./useCollisionAvoidance";
import { useGroupDrag } from "./useGroupDrag";

export interface SelectionAwareDragOptions {
  /** Stable collision participant id — a mover and an obstacle are the same participant. */
  participantId: string;
  /** The element that actually moves, when that isn't the drag handle itself. */
  targetRef: RefObject<HTMLElement | null>;
  /** The id this box is selected/deselected under in `selectionStore`. */
  selectionId: string;
  /** The id this box's offset lives under in `dragOffsets`/`onCommit`/`onCommitMany` — defaults to
   * `selectionId` for every caller except C1's boxes, whose dagre box id and canvas node id are two
   * separate namespaces. */
  dragId?: string;
  initialOffset?: Offset;
  /** Every box's live offset, keyed by `dragId` — a group drag reads every OTHER selected box's
   * current offset from here to capture the group's honest starting positions. */
  dragOffsets: ReadonlyMap<string, Offset>;
  onOffsetChange: (dragId: string, offset: Offset) => void;
  onCommit: (dragId: string, offset: Offset) => void;
  /** Batched commit for a group drag — every selected box's landing saved in one call. */
  onCommitMany: (offsets: Record<string, Offset>) => void;
  /** Maps a selected id (from `selectionStore`) to its drag id, for reading group membership —
   * identity by default; C1's boxes need the canvas-node-id -> dagre-box-id reverse lookup instead. */
  dragIdForSelectionId?: (selectionId: string) => string | null;
}

export interface SelectionAwareDrag {
  isSelected: boolean;
  isDragging: boolean;
  handleProps: DragHandleProps;
  ghost: DropGhostGeometry | null;
  /** Where to actually render this box's offset right now — already reconciled between this box's
   * own drag state and a passive group member's `dragOffsets` entry. */
  renderOffset: Offset;
}

/**
 * The Miro-style multi-select drag behind every draggable box (C1's anchors, the top-level hierarchy
 * boxes, the Patterns view's nodes): solo drag with collision-avoidance settling below a 2-selection,
 * a free group move at 2+, and the render-offset reconciliation between them. The three call sites
 * used to each hold an identical ~80-line copy of this; they now differ only in which id namespace
 * they pass in.
 */
export function useSelectionAwareDrag({
  participantId,
  targetRef,
  selectionId,
  dragId = selectionId,
  initialOffset,
  dragOffsets,
  onOffsetChange,
  onCommit,
  onCommitMany,
  dragIdForSelectionId = (id) => id,
}: SelectionAwareDragOptions): SelectionAwareDrag {
  const isSelected = useIsSelected(selectionId);
  const selectedCount = useSelectedCount();
  const isGroupDrag = isSelected && selectedCount > 1;
  // The single source of truth for this box's current offset — read fresh at the start of every
  // gesture (see useDragOffset's resolveStartOffset) so switching between solo and group drags
  // across separate gestures can never leave either hook's own state stale.
  const resolveStartOffset = useCallback(
    () => dragOffsets.get(dragId) ?? { x: 0, y: 0 },
    [dragOffsets, dragId],
  );

  const solo = useCollisionAvoidance({
    id: participantId,
    targetRef,
    suppressClickAfterDrag: true,
    initialOffset,
    enabled: !isGroupDrag,
    resolveStartOffset,
    onEnd: (finalOffset) => {
      // A solo drag on a box outside the current selection means the user has moved on from
      // whatever was selected before — without this, a stale multi-selection from an earlier
      // shift-click/marquee silently turns a later solo drag on one of those boxes into a group
      // drag that also moves the others.
      if (!isSelected) selectionStore.clear();
      onCommit(dragId, finalOffset);
    },
  });
  const group = useGroupDrag({
    enabled: isGroupDrag,
    initialOffset,
    suppressClickAfterDrag: true,
    resolveStartOffset,
    selectedIds: () =>
      selectionStore
        .getSelectedIds()
        .map(dragIdForSelectionId)
        .filter((id): id is string => id !== null),
    getOffset: (id) => dragOffsets.get(id) ?? { x: 0, y: 0 },
    onGroupPreview: (offsets) => {
      for (const [id, boxOffset] of Object.entries(offsets)) onOffsetChange(id, boxOffset);
    },
    onGroupCommit: (offsets) => {
      onCommitMany(offsets);
      selectionStore.clear();
    },
  });

  const active = isGroupDrag ? group : solo;
  const { offset, isDragging, handleProps } = active;
  const ghost = isGroupDrag ? null : solo.ghost;
  // A passive member of a group drag (selected, but not the box the pointer is actually on) never
  // gets its own pointer events, so its own drag hook's `offset` never changes — the group's delta
  // reaches it only through `onGroupPreview` pushing a new value into the parent's `dragOffsets`
  // map. While this box isn't itself the live gesture, render from that map instead of the local
  // (stale) offset, or it stays visually frozen while the arrows — which DO read dragOffsets —
  // move to its new position, making the box look like it fell behind or vanished from the group.
  // During a GROUP drag this now applies to the handle too: its own `offset` updates on every raw
  // pointermove (unthrottled), while every other member only moves once per animation frame via
  // `onGroupPreview` — rendering the handle from its own instant state let it visibly run ahead of
  // the rest of the selection, which is the "some blocks jump" bug. Reading everyone from the same
  // rAF-throttled `dragOffsets` map during a group drag keeps the whole selection on one clock. The
  // `?? offset` fallback must NOT apply here while dragging as the group's handle: `offset` is that
  // same live, unthrottled value, and this box has no `dragOffsets` entry yet on its very first-ever
  // gesture — falling back to `offset` would silently readmit the instant value the whole point of
  // this branch is to avoid. `initialOffset` (this box's untouched, pre-gesture seed) is safe there.
  const renderOffset = isDragging
    ? isGroupDrag
      ? dragOffsets.get(dragId) ?? initialOffset ?? { x: 0, y: 0 }
      : offset
    : dragOffsets.get(dragId) ?? offset;

  // `active` switches to the other hook the instant the selection changes, with no gesture
  // involved — and that other hook's own `offset` may just be its untouched mount-time seed.
  // Pushing that stale value over the correct one right on the switch would clobber a
  // just-committed group-drag position, so the switch render itself must be skipped.
  //
  // Detecting the switch (comparing against the PREVIOUS render's mode) has to happen inside the
  // effect, not during render: React StrictMode double-invokes render function bodies in
  // development, and a ref mutated during render isn't rolled back between those two invocations.
  // Mutating `wasGroupDragRef.current` here used to mean the second (actually committed)
  // invocation saw the ref already flipped by the first (discarded) one, so `modeJustSwitched`
  // silently read `false` on the real switch render — the stale offset went through anyway,
  // resetting the box back to its pre-drag position immediately after every group-drag commit.
  const previousIsGroupDragRef = useRef(isGroupDrag);
  useEffect(() => {
    const modeJustSwitched = previousIsGroupDragRef.current !== isGroupDrag;
    previousIsGroupDragRef.current = isGroupDrag;
    // During a group drag `onGroupPreview` already pushes every selected id's offset (this one
    // included) into `dragOffsets` once per frame — a second, unthrottled write here from this
    // box's own `offset` would race that channel and is exactly the other half of the same jump.
    if (modeJustSwitched || isGroupDrag) return;
    onOffsetChange(dragId, offset);
  }, [dragId, offset, onOffsetChange, isGroupDrag]);

  return { isSelected, isDragging, handleProps, ghost, renderOffset };
}
