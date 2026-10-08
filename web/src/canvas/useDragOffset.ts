import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { PAN_IGNORE_SELECTOR } from "./CanvasViewport";
import { applyDragAxisLock, reportDragEnd } from "./dragAxisLock";

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  scale: number;
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 4;

// A finished drag's own synthesized click gets swallowed (see suppressNextClick) so it can't also
// fire whatever the moved element's plain click does (open code, toggle expand, ...). That's right
// for a real drag, but DRAG_THRESHOLD_PX alone is too twitchy a line for it: a trackpad's physical
// click depression, or an ordinary mouse's own jitter, routinely crosses 4px on a gesture the user
// experienced as a single click — which used to eat that exact click, making the block look like it
// silently ignored the first press until a second, slightly steadier one got through. Suppression
// now waits for a distinctly larger, unambiguous drag before it engages; the block can still nudge a
// few px on a release below this line (onEnd's own commit is unaffected), but the click that
// (mis)classified press also gets to open the panel/toggle as normal.
const CLICK_SUPPRESS_THRESHOLD_PX = 12;

export interface DragHandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

/** The pointerdown guard every draggable canvas-doc element (hierarchy pin, note, C1 box) applies
 * before starting its own drag: a pan-ignore target keeps its own handling, and a held Shift means
 * the user is starting a marquee instead, which must still reach CanvasViewport's own listener. */
export function elementDragPointerDown(
  handleProps: DragHandleProps,
): (event: PointerEvent<HTMLElement>) => void {
  return (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(PAN_IGNORE_SELECTOR)) return;
    if (event.shiftKey) return;
    event.stopPropagation();
    handleProps.onPointerDown(event);
  };
}

/** Swallows the single click a just-finished drag synthesizes, wherever it lands — depending on
 * where the pointer ends up it can target the handle, the block under it, or their common
 * ancestor, so only a document-level capture listener reliably catches it before any element
 * handler (e.g. a block's expand toggle). Disarmed by the next pointerdown (a fresh gesture) or
 * on the next tick, in case no click follows the drag at all. */
function suppressNextClick() {
  const swallow = (event: Event) => {
    event.stopPropagation();
    disarm();
  };
  const disarm = () => {
    document.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerdown", disarm, true);
  };
  document.addEventListener("click", swallow, { capture: true });
  document.addEventListener("pointerdown", disarm, { capture: true });
  setTimeout(disarm, 0);
}

export interface Offset {
  x: number;
  y: number;
}

/** What a preview/resolve hook needs to know about the gesture in progress, so it can reason about
 * the offset in canvas coordinates without measuring anything a second time. */
export interface DragContext {
  /** The drag handle — `measureScale`'s input, and the element a resolver walks up from. */
  handle: HTMLElement;
  /** Canvas zoom measured once at drag start, already divided out of the offsets below. */
  scale: number;
  /** The offset the element sat at when the gesture began. */
  startOffset: Offset;
}

export interface DragOffsetOptions {
  /** Swallow the click a finished drag synthesizes. Needed when the whole draggable surface has
   * click behavior of its own (the C1 box anchors, where the drag-end click would land on the
   * block and toggle it); panel headers don't need it — their drag-end click harmlessly targets
   * the header itself. */
  suppressClickAfterDrag?: boolean;
  /** Starting offset, read once on mount — lets a consumer restore a previously-saved position
   * (the C1 box anchors seed this from .codechroma/c1-layout.json). */
  initialOffset?: Offset;
  /** Explicit canvas zoom to divide drag deltas by, instead of measuring it from the drag handle via
   * `measureScale`. For a drag handle that `measureScale` can't size (an SVG element has no
   * `offsetWidth`), so it would read scale 1 and the element would outrun/underrun the cursor at any
   * zoom other than 1 — the exact wrong behaviour for the canvas arrow labels, which live inside the
   * scaled `.canvas-content` like the blocks do. A function is evaluated fresh at each gesture start
   * (like `measureScale`, which reads the live DOM), so a zoom change between gestures is honoured. */
  scale?: number | (() => number);
  /** Fired once when a real drag (past the threshold) ends, with the final offset — the
   * commit-on-drop hook, so a consumer persists once per drag rather than on every pointer move. */
  onEnd?: (offset: Offset) => void;
  /** Called with the live offset on every drag frame, rAF-throttled — the collision solver's hook
   * for working out in advance where the block will land. Absent (CodeView, CodePopup, DiffView,
   * the agent windows) means no per-frame work happens at all, which is the exemption mechanism:
   * a code panel is a window over the map and is meant to overlap. */
  onPreview?: (offset: Offset, context: DragContext) => void;
  /** Last chance to adjust the offset before it is committed: what this returns becomes both the
   * element's own offset and `onEnd`'s argument, so a corrected landing is what gets persisted.
   * Absent means the raw release point is committed, exactly as before. */
  resolveFinal?: (offset: Offset, context: DragContext) => Offset;
  /** Called once at the start of each new gesture to get the authoritative current offset,
   * overriding this hook's own (possibly stale) `offset` state as the gesture's baseline. Needed
   * when something OTHER than this hook's own past gestures can move the element — e.g. a group
   * drag driven entirely by a sibling's pointer events, which this hook never sees, so its own
   * `offset` state silently falls behind whatever the group actually moved this element to.
   * Absent means "trust my own state," the original behavior. */
  resolveStartOffset?: () => Offset;
}

export interface DragOffset {
  offset: Offset;
  isDragging: boolean;
  handleProps: DragHandleProps;
  /** Zeroes the local offset immediately -- for a consumer that folds a finished drag's delta into
   * its own persisted base position (canvas-doc's `update_element`) rather than treating the offset
   * itself as the thing that gets persisted (the hierarchy's saved-layout boxes, which pass their
   * own `initialOffset` back in on remount instead). Skipping this call after such a commit leaves
   * the just-applied delta double-counted on every render until the component remounts: the base
   * position already moved by the delta, and the un-reset offset still adds it a second time.
   * Optional because the composed `DragOffset`-shaped values `useCollisionAvoidance`/`useGroupDrag`
   * build by hand don't need it -- their model never folds the offset into a base position. */
  resetOffset?: () => void;
}

/** Drag-to-reposition state shared by CodePopup's title bar, the inline CodeView/ChangeCardsPanel
 * headers, and the C1 view's box anchors: spread `handleProps` onto the drag-handle element and
 * apply `offset` to the panel. Once a drag starts, moves are tracked via document-level listeners
 * rather than pointer capture — the handle can be arbitrarily small (the pointer instantly leaves
 * it) and capture would retarget the drag-end click away from whatever is under the cursor,
 * breaking plain clicks on elements beneath the handle. Offset is local, transient state — it
 * resets whenever the consumer remounts. */
export function useDragOffset({
  suppressClickAfterDrag = false,
  initialOffset,
  scale: scaleOverride,
  onEnd: onDragEnd,
  onPreview,
  resolveFinal,
  resolveStartOffset,
}: DragOffsetOptions = {}): DragOffset {
  const [offset, setOffset] = useState(initialOffset ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resetOffset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  // Detach the document listeners if the consumer unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    // Buttons inside the handle (e.g. the popup's close button) must not start a drag.
    if ((event.target as HTMLElement).closest("button")) return;
    if (cleanupRef.current) return;
    // Resync to the authoritative current position before reading it as this gesture's baseline —
    // this hook's own `offset` state can only reflect gestures it has itself run, so it silently
    // falls behind whenever something else (a sibling's group drag) moved this element instead.
    const startOffset = resolveStartOffset ? resolveStartOffset() : offset;
    if (startOffset.x !== offset.x || startOffset.y !== offset.y) setOffset(startOffset);
    const drag: DragState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: startOffset.x,
      startOffsetY: startOffset.y,
      scale: typeof scaleOverride === "function" ? scaleOverride() : scaleOverride ?? measureScale(event.currentTarget),
      moved: false,
    };

    const context: DragContext = {
      handle: event.currentTarget,
      scale: drag.scale,
      startOffset: { x: drag.startOffsetX, y: drag.startOffsetY },
    };
    // The preview runs at most once per painted frame; the raw setOffset path below is untouched,
    // since retiming that would change how the drag feels for every consumer.
    let previewFrame: number | null = null;
    let previewPending: Offset | null = null;
    const flushPreview = () => {
      previewFrame = null;
      const pending = previewPending;
      previewPending = null;
      if (pending) onPreview?.(pending, context);
    };
    const cancelPreviewFrame = () => {
      if (previewFrame === null) return;
      cancelAnimationFrame(previewFrame);
      previewFrame = null;
    };

    let latest = { x: drag.startOffsetX, y: drag.startOffsetY };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      const { dx, dy } = applyDragAxisLock(
        moveEvent.clientX - drag.startClientX,
        moveEvent.clientY - drag.startClientY,
      );
      // A press only becomes a drag past the threshold, so an ordinary click never moves the panel.
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!drag.moved) {
        drag.moved = true;
        setIsDragging(true);
      }
      latest = { x: drag.startOffsetX + dx / drag.scale, y: drag.startOffsetY + dy / drag.scale };
      setOffset(latest);
      if (!onPreview) return;
      previewPending = latest;
      if (previewFrame === null) previewFrame = requestAnimationFrame(flushPreview);
    };
    const onEnd = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== drag.pointerId) return;
      const releaseDistance = Math.hypot(
        endEvent.clientX - drag.startClientX,
        endEvent.clientY - drag.startClientY,
      );
      if (drag.moved && suppressClickAfterDrag && releaseDistance >= CLICK_SUPPRESS_THRESHOLD_PX) {
        suppressNextClick();
      }
      if (drag.moved) {
        // Run the frame the pointer outran, so the resolver decides from the release point rather
        // than from wherever the last painted frame left it.
        cancelPreviewFrame();
        flushPreview();
        const resolved = resolveFinal ? resolveFinal(latest, context) : latest;
        if (resolved.x !== latest.x || resolved.y !== latest.y) setOffset(resolved);
        onDragEnd?.(resolved);
        reportDragEnd();
      }
      cleanup();
    };
    const cleanup = () => {
      cancelPreviewFrame();
      previewPending = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      cleanupRef.current = null;
      setIsDragging(false);
    };
    cleanupRef.current = cleanup;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  }

  return {
    offset,
    isDragging,
    handleProps: {
      onPointerDown: handlePointerDown,
    },
    resetOffset,
  };
}

/** Panels inside the canvas are scaled by `.canvas-content`'s transform, so screen-pixel drag
 * deltas must be divided by that scale. Measured from the handle's rendered-vs-layout width —
 * falls back to 1 outside the canvas (the popup) and in jsdom, where both widths are 0. Exported
 * for useResizableSize.ts, which needs the same compensation for inline (in-canvas) resizing. */
export function measureScale(handle: HTMLElement): number {
  const raw = handle.getBoundingClientRect().width / handle.offsetWidth;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
