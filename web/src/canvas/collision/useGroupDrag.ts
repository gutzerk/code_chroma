import { useCallback, useEffect, useRef } from "react";
import { useDragOffset, type DragHandleProps, type DragOffset, type Offset } from "../useDragOffset";

export interface GroupDragOptions {
  /** Every currently selected id (this element's own included), read fresh at drag-start time —
   * not just once at mount, since the selection can change between drags. */
  selectedIds: () => readonly string[];
  /** This id's live offset, so the group's starting positions are captured honestly even if a prior
   * drag already displaced some of them. */
  getOffset: (id: string) => Offset;
  /** Fired every preview frame with every selected id's new offset (this element's own included). */
  onGroupPreview: (offsets: Record<string, Offset>) => void;
  /** Fired once at drag end, so the caller can persist every moved id in one batched save. */
  onGroupCommit: (offsets: Record<string, Offset>) => void;
  initialOffset?: Offset;
  suppressClickAfterDrag?: boolean;
  /** Off switch — a solo drag (this element not part of a 2+ selection) uses plain
   * useCollisionAvoidance instead, so this hook does nothing when disabled. */
  enabled?: boolean;
  /** The authoritative current offset, read fresh at the start of every gesture — this element's
   * own drag state only ever moves when IT is the handle, so it goes stale the moment this box
   * spends a gesture as a passive group member (or a solo drag) instead. Without resyncing to
   * this, a later gesture on this same element would start from the wrong baseline and jump.
   * Every real call site provides it; absent (as in a hook-only unit test) means "trust my own
   * state," matching useDragOffset's own default. */
  resolveStartOffset?: () => Offset;
}

/**
 * Moves an entire multi-selection together, Miro-style: the dragged block's own delta-from-start is
 * applied to every other selected block's own starting offset, with no collision avoidance — a free
 * group move, deliberately distinct from a solo drag's settle-beside-a-neighbour behaviour
 * (useCollisionAvoidance). Only ever active while 2+ blocks are selected and the drag started on one
 * of them; callers gate `enabled` on that and fall back to useCollisionAvoidance otherwise.
 */
export function useGroupDrag({
  selectedIds,
  getOffset,
  onGroupPreview,
  onGroupCommit,
  initialOffset,
  suppressClickAfterDrag,
  enabled = true,
  resolveStartOffset,
}: GroupDragOptions): DragOffset {
  // Captured at pointerdown (not deferred to the first preview frame): the group's own starting
  // positions, and the handle's own starting offset so every later frame's delta is relative to it.
  const groupStartRef = useRef<Map<string, Offset> | null>(null);
  const handleStartRef = useRef<Offset | null>(null);

  const propagate = useCallback((offset: Offset): Record<string, Offset> | null => {
    const start = groupStartRef.current;
    const handleStart = handleStartRef.current;
    if (!start || !handleStart) return null;
    const delta = { x: offset.x - handleStart.x, y: offset.y - handleStart.y };
    const next: Record<string, Offset> = {};
    for (const [otherId, otherStart] of start) {
      next[otherId] = { x: otherStart.x + delta.x, y: otherStart.y + delta.y };
    }
    return next;
  }, []);

  const drag = useDragOffset({
    initialOffset,
    suppressClickAfterDrag,
    resolveStartOffset,
    onEnd: enabled
      ? (offset) => {
          const next = propagate(offset);
          groupStartRef.current = null;
          handleStartRef.current = null;
          if (next) onGroupCommit(next);
        }
      : undefined,
  });

  // A caller that builds `onGroupPreview` inline (every real call site does — it closes over the
  // element/selection currently in scope) hands this hook a new function identity every render.
  // Reading it through a ref updated during render, rather than depending on it directly, keeps the
  // effect below from re-running on that identity change alone: `onGroupPreview` calling into a
  // subscribed store (canvas-doc's own dragOffsetStore) triggers a re-render, which would otherwise
  // produce yet another fresh closure and re-fire the effect again next tick — an infinite loop with
  // no real drag movement involved at all, caught by CanvasNodeBox's own group-drag test.
  const onGroupPreviewRef = useRef(onGroupPreview);
  onGroupPreviewRef.current = onGroupPreview;

  // Every selected id (this element's own included) has to move on the SAME clock the handle's own
  // pointer tracking already runs on — `drag.offset` updates synchronously on every raw pointermove,
  // unthrottled (see useDragOffset). Routing the group's propagation through the rAF-throttled
  // `onPreview` channel instead used to leave passive members up to one frame behind the handle
  // during the drag, and forced a visible "catch up to the true release point" snap the instant the
  // gesture ended — mirroring this effect off `drag.offset` directly keeps the whole selection
  // exactly as responsive as a solo drag, with nothing left to catch up on release.
  useEffect(() => {
    if (!enabled) return;
    const next = propagate(drag.offset);
    if (next) onGroupPreviewRef.current(next);
  }, [drag.offset, enabled, propagate]);

  const handleProps: DragHandleProps = {
    onPointerDown: (event) => {
      if (enabled) {
        handleStartRef.current = resolveStartOffset ? resolveStartOffset() : drag.offset;
        const start = new Map<string, Offset>();
        for (const id of selectedIds()) start.set(id, getOffset(id));
        groupStartRef.current = start;
      }
      drag.handleProps.onPointerDown(event);
    },
  };

  return { offset: drag.offset, isDragging: drag.isDragging, handleProps };
}
