import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { canvasLayoutStore } from "../../state/canvasLayoutStore";
import {
  measureScale,
  useDragOffset,
  type DragContext,
  type DragOffset,
  type DragOffsetOptions,
  type Offset,
} from "../useDragOffset";
import { collisionStore } from "./collisionStore";
import { LANDING_HYSTERESIS_PX, SETTLE_MS } from "./constants";
import { hasCollision, resolveDrop, type Obstacle, type Rect } from "./resolveDrop";

/** The projected landing, in `.canvas-content`'s own untransformed coordinates so the outline tracks
 * pan and zoom for free, plus the element to portal it into. */
export interface DropGhostGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The solver gave up: the outline is drawn dimmed at the release point rather than pretending. */
  blocked: boolean;
  container: HTMLElement;
}

export interface CollisionAvoidanceOptions extends DragOffsetOptions {
  /** Stable key this element registers under — a mover and an obstacle are the same participant. */
  id: string;
  /** The element that actually moves, when that isn't the drag handle itself: the panels are dragged
   * by a header inside them, the C1 anchors by their whole box. */
  targetRef?: RefObject<HTMLElement | null>;
  /** Off switch for a consumer rendered non-draggable — falls back to plain useDragOffset. */
  enabled?: boolean;
  /** Fired on the same synchronous clock the returned `offset` renders from while a solo drag is in
   * flight — the live-offset path for consumers that must move OTHER things (frames, arrows) in
   * lockstep with the box. Separate from `onPreview`, which is this hook's own rAF-throttled ghost
   * solve: a consumer that needs the box's true render-position must read it here, not in the
   * throttle, or it chases the box a frame behind. */
  onLiveOffset?: (offset: Offset) => void;
}

export interface CollisionAvoidance extends DragOffset {
  ghost: DropGhostGeometry | null;
  blocked: boolean;
}

interface Gesture {
  scale: number;
  target: HTMLElement;
  /** Null outside the canvas (CodePopup's screen-space panels) — then there is no ghost and no solve. */
  container: HTMLElement | null;
  /** Container origin in canvas coordinates, cached: it cannot move while a block is being dragged,
   * and re-reading it per frame would add a second forced layout to every preview. */
  containerOrigin: Offset;
  /** The moving box as it sat at the gesture's starting offset. */
  startRect: Rect;
  /** Snapshotted on the first previewed frame — the scene doesn't change while dragging. */
  obstacles: Obstacle[] | null;
  landing: Offset | null;
  blocked: boolean;
}

interface PendingSettle {
  element: HTMLElement;
  commit: () => void;
  timer: ReturnType<typeof setTimeout>;
  onTransitionEnd: () => void;
}

// transitionend is not guaranteed: the element can unmount or the tab can be backgrounded mid-flight.
// Without a fallback the corrected position would silently never persist.
const SETTLE_FALLBACK_MS = SETTLE_MS + 40;

/**
 * Gives one draggable element the "settles into the nearest free spot" behaviour: it follows the
 * cursor honestly, even straight over a neighbour, and on release travels into the position the ghost
 * has been showing all along.
 *
 * Wires `collisionStore` and `resolveDrop` into `useDragOffset`'s two optional hooks, so opting in is
 * a call-site decision — `CodeView`, `CodePopup` and `DiffView` keep calling `useDragOffset` bare and
 * keep overlapping whatever they like.
 */
export function useCollisionAvoidance({
  id,
  targetRef,
  enabled = true,
  onEnd,
  onLiveOffset,
  ...dragOptions
}: CollisionAvoidanceOptions): CollisionAvoidance {
  const [ghost, setGhost] = useState<DropGhostGeometry | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const settleRef = useRef<PendingSettle | null>(null);
  // The settle spans an animation, so the commit callback is read at completion time rather than
  // captured from the render that started the drag.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  /** Ends a landing animation now: strips the transition, commits once, and recomputes the arrows
   * once. Idempotent, so several transitionend events (one per animated property) plus the timeout
   * fallback can all race into it without producing a second onEnd. */
  const finishSettle = useCallback(() => {
    const settle = settleRef.current;
    if (!settle) return;
    settleRef.current = null;
    clearTimeout(settle.timer);
    settle.element.removeEventListener("transitionend", settle.onTransitionEnd);
    settle.element.style.transition = "";
    settle.commit();
    canvasLayoutStore.bump();
  }, []);

  useEffect(() => finishSettle, [finishSettle]);

  const handlePreview = useCallback(
    (offset: Offset, context: DragContext) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (!gesture.obstacles) {
        collisionStore.beginGesture(gesture.scale);
        gesture.obstacles = collisionStore.rectsExcept(id, gesture.scale, gesture.target);
      }
      const obstacles = gesture.obstacles;
      if (obstacles.length === 0) {
        setGhost(null);
        return;
      }

      const rectAt = (at: Offset): Rect => ({
        width: gesture.startRect.width,
        height: gesture.startRect.height,
        x: gesture.startRect.x + (at.x - context.startOffset.x),
        y: gesture.startRect.y + (at.y - context.startOffset.y),
      });

      const released = rectAt(offset);
      const solved = resolveDrop(released, obstacles);
      const candidate = {
        x: offset.x + (solved.x - released.x),
        y: offset.y + (solved.y - released.y),
      };

      const settled = pickLanding(gesture, offset, candidate, solved.blocked, (at) =>
        hasCollision(rectAt(at), obstacles),
      );
      gesture.landing = settled.landing;
      gesture.blocked = settled.blocked;

      // An outline sitting exactly under the block is noise, so only a real correction gets a ghost —
      // a blocked release is the exception: that dimmed outline IS the message.
      const needsGhost =
        settled.blocked ||
        settled.landing.x !== offset.x ||
        settled.landing.y !== offset.y;
      if (!needsGhost || !gesture.container) {
        setGhost(null);
        return;
      }
      const landingRect = rectAt(settled.landing);
      setGhost({
        left: landingRect.x - gesture.containerOrigin.x,
        top: landingRect.y - gesture.containerOrigin.y,
        width: landingRect.width,
        height: landingRect.height,
        blocked: settled.blocked,
        container: gesture.container,
      });
    },
    [id],
  );

  /** Takes the landing the ghost is already showing and arms the transition, so the offset React is
   * about to commit animates into it instead of jumping. */
  const handleResolveFinal = useCallback((offset: Offset): Offset => {
    const gesture = gestureRef.current;
    const landing = gesture?.landing;
    if (!gesture || !landing) return offset;
    if (landing.x === offset.x && landing.y === offset.y) return offset;
    // Both property sets, because the two consumer families position differently: the C1 anchors
    // through left/top, the floating panels through a transform.
    gesture.target.style.transition = ["transform", "left", "top"]
      .map((property) => `${property} ${SETTLE_MS}ms ease-out`)
      .join(", ");
    settleRef.current = {
      element: gesture.target,
      commit: () => onEndRef.current?.(landing),
      timer: setTimeout(finishSettle, SETTLE_FALLBACK_MS),
      onTransitionEnd: finishSettle,
    };
    gesture.target.addEventListener("transitionend", finishSettle);
    return landing;
  }, [finishSettle]);

  const handleEnd = useCallback(
    (finalOffset: Offset) => {
      collisionStore.endGesture();
      gestureRef.current = null;
      setGhost(null);
      // With no animation to wait for there is nothing to defer — the raw release point is committed
      // exactly as it always was.
      if (!settleRef.current) onEndRef.current?.(finalOffset);
    },
    [],
  );

  const drag = useDragOffset({
    ...dragOptions,
    onEnd: handleEnd,
    // `onPreview` is this hook's own rAF-throttled ghost solve and nothing else — it IS the
    // `onLiveOffset` slot for the raw live offset, which gets its own synchronous channel below.
    onPreview: enabled ? handlePreview : undefined,
    resolveFinal: enabled ? handleResolveFinal : undefined,
  });

  // The live-offset path, mirroring `useGroupDrag`'s own render-clock publish: fire on the same
  // synchronous tick `drag.offset` becomes `drag.isDragging`, so a consumer moving other things off
  // this offset (frames, arrows) stays in lockstep with the box instead of chasing it a frame late.
  // Read through a ref so the effect does not restart when the caller passes a fresh closure each
  // render (every caller does -- it closes over the id in scope).
  const onLiveOffsetRef = useRef(onLiveOffset);
  onLiveOffsetRef.current = onLiveOffset;
  useEffect(() => {
    if (!drag.isDragging) return;
    onLiveOffsetRef.current?.(drag.offset);
  }, [drag.isDragging, drag.offset]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // A new gesture interrupts a landing still in flight: complete it once, cleanly, rather than
      // leaving a transition armed and a second onEnd queued behind this drag's.
      finishSettle();
      gestureRef.current = null;
      const handle = event.currentTarget;
      const target = targetRef?.current ?? handle;
      const startsDrag =
        enabled && event.button === 0 && !(event.target as HTMLElement).closest("button");
      if (startsDrag) {
        const scale = measureScale(handle);
        const rect = target.getBoundingClientRect();
        const container = target.closest<HTMLElement>(".canvas-content");
        // Read once here, before any movement, so the whole gesture reasons off a box that is
        // known to correspond to the starting offset. A 0×0 rect means jsdom or an unlaid-out
        // element — nothing to solve against, so the drag stays plain.
        if (rect.width > 0 && rect.height > 0) {
          const containerRect = container?.getBoundingClientRect();
          gestureRef.current = {
            scale,
            target,
            container,
            containerOrigin: {
              x: (containerRect?.left ?? 0) / scale,
              y: (containerRect?.top ?? 0) / scale,
            },
            startRect: {
              x: rect.left / scale,
              y: rect.top / scale,
              width: rect.width / scale,
              height: rect.height / scale,
            },
            obstacles: null,
            landing: null,
            blocked: false,
          };
        }
      }
      drag.handleProps.onPointerDown(event);
    },
    [drag.handleProps, enabled, finishSettle, targetRef],
  );

  return {
    offset: drag.offset,
    isDragging: drag.isDragging,
    handleProps: { onPointerDown: handlePointerDown },
    ghost: drag.isDragging ? ghost : null,
    blocked: ghost?.blocked ?? false,
    resetOffset: drag.resetOffset,
  };
}

/** Hysteresis: a fresh candidate has to beat the landing already on screen by LANDING_HYSTERESIS_PX
 * before it replaces it, so the outline doesn't flicker as the pointer crosses the boundary between
 * two equally good solutions. A proposal that has since become illegal is dropped regardless. */
function pickLanding(
  gesture: Gesture,
  released: Offset,
  candidate: Offset,
  blocked: boolean,
  collides: (at: Offset) => boolean,
): { landing: Offset; blocked: boolean } {
  const isCorrectionFree = !blocked && candidate.x === released.x && candidate.y === released.y;
  // Nothing to hold on to: the raw release point became legal, so any ghost must go immediately.
  if (isCorrectionFree) return { landing: candidate, blocked: false };

  const current = gesture.landing;
  if (!current || gesture.blocked || collides(current)) return { landing: candidate, blocked };

  const distanceToCurrent = Math.hypot(current.x - released.x, current.y - released.y);
  const distanceToCandidate = Math.hypot(candidate.x - released.x, candidate.y - released.y);
  if (distanceToCurrent - distanceToCandidate <= LANDING_HYSTERESIS_PX) {
    return { landing: current, blocked: false };
  }
  return { landing: candidate, blocked };
}
