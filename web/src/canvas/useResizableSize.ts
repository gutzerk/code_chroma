import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { clamp } from "../util/clamp";
import { measureScale } from "./useDragOffset";

interface ResizeState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MAX_VIEWPORT_FRACTION = 0.95;

export interface ResizeHandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

export interface ResizableSize {
  size: Size | null;
  isResizing: boolean;
  handleProps: ResizeHandleProps;
  /** Drops the local override so the caller's own size prop (e.g. a persisted geometry) shows again
   * -- for a consumer whose size can also change from outside this handle's own drag. */
  resetSize: () => void;
}

export interface ResizableOptions {
  axis?: "both" | "x" | "y";
  edge?: "right" | "left" | "top";
  minWidth?: number;
  minHeight?: number;
  /** Clamps the resized axis to this fraction of the viewport — width for "x", height for "y". */
  maxViewportFraction?: number;
}

/** Drag-to-resize state for a panel handle: spread `handleProps` onto the handle element and apply
 * `size` as explicit width/height once set — before the first drag, `size` is null and the panel's
 * CSS default sizing applies. Defaults to a bottom-right corner handle resizing both axes (the code
 * popup, which renders outside `.canvas-content`'s zoom transform so `measureScale` resolves to 1,
 * and the inline code/diff panels, which live inside it and need the same scale compensation
 * `useDragOffset` uses). Pass `{ axis: "x", edge: "left" }` for a left-edge, width-only handle on a
 * right-anchored panel (the inspector), where dragging left widens the panel, or
 * `{ axis: "y", edge: "top" }` for a top-edge, height-only handle on a bottom-anchored one (the
 * terminal), where dragging up makes it taller; `minWidth`/`minHeight` and `maxViewportFraction`
 * override the clamp bounds. */
export function useResizableSize(
  panelRef: RefObject<HTMLElement | null>,
  options: ResizableOptions = {},
): ResizableSize {
  const {
    axis = "both",
    edge = "right",
    minWidth = MIN_WIDTH,
    minHeight = MIN_HEIGHT,
    maxViewportFraction = MAX_VIEWPORT_FRACTION,
  } = options;
  const [size, setSize] = useState<Size | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<ResizeState | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const scale = measureScale(event.currentTarget);
    // getBoundingClientRect() reports the panel's on-screen (post canvas-zoom) size, but `size`
    // is applied as a CSS width/height on an element that then gets scaled by the ancestor
    // transform — so the fallback (first-ever resize, before `size` is set) must convert screen
    // pixels back to that same logical/local space, or the panel would jump to a wrong size the
    // instant a resize starts on anything other than the popup (which sits outside the canvas's
    // zoom transform, where scale is always 1 and this division is a no-op).
    const rect = panelRef.current?.getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: size?.width ?? (rect ? rect.width / scale : minWidth),
      startHeight: size?.height ?? (rect ? rect.height / scale : minHeight),
      scale,
    };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const rawDx = (event.clientX - resize.startClientX) / resize.scale;
    const dx = edge === "left" ? -rawDx : rawDx;
    const rawDy = (event.clientY - resize.startClientY) / resize.scale;
    // A top-edge handle on a bottom-anchored panel grows it upward, exactly as a left-edge handle on
    // a right-anchored one grows it leftward.
    const dy = edge === "top" ? -rawDy : rawDy;
    // Same logical-space conversion as above: the viewport-fraction ceiling is a screen-space
    // limit, so it has to be divided by scale too before comparing against logical width/height.
    // The caller's fraction applies to whichever axis it is actually resizing.
    const widthFraction = axis === "y" ? MAX_VIEWPORT_FRACTION : maxViewportFraction;
    const heightFraction = axis === "y" ? maxViewportFraction : MAX_VIEWPORT_FRACTION;
    const maxWidth = (window.innerWidth * widthFraction) / resize.scale;
    const maxHeight = (window.innerHeight * heightFraction) / resize.scale;
    setSize({
      width:
        axis === "y" ? resize.startWidth : clamp(resize.startWidth + dx, minWidth, maxWidth),
      height:
        axis === "x" ? resize.startHeight : clamp(resize.startHeight + dy, minHeight, maxHeight),
    });
  }

  function endResize(event: PointerEvent<HTMLElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    setIsResizing(false);
  }

  return {
    size,
    isResizing,
    handleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endResize,
      onPointerCancel: endResize,
    },
    resetSize: () => setSize(null),
  };
}
