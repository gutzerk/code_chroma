import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export interface PanZoomView {
  x: number;
  y: number;
  scale: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
const DRAG_THRESHOLD = 4;
const WHEEL_STEP = 0.0015;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Zooms about a cursor point so the content under it stays put (same maths as `CanvasViewport`'s `zoomAround`). */
export function zoomAround(view: PanZoomView, cursorX: number, cursorY: number, factor: number): PanZoomView {
  const scale = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM);
  return {
    scale,
    x: cursorX - ((cursorX - view.x) / view.scale) * scale,
    y: cursorY - ((cursorY - view.y) / view.scale) * scale,
  };
}

/** Pointer-drag pan (after a small threshold) and wheel zoom toward the cursor over `bodyRef`, starting from `base`. */
export function usePanZoom(bodyRef: RefObject<HTMLElement | null>, base: PanZoomView, active: boolean) {
  const [view, setView] = useState<PanZoomView>(base);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; origin: PanZoomView; moved: boolean } | null>(null);

  useEffect(() => setView({ x: base.x, y: base.y, scale: base.scale }), [base.x, base.y, base.scale]);

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      const cx = (rect?.width ?? 0) / 2;
      const cy = (rect?.height ?? 0) / 2;
      setView((v) => zoomAround(v, cx, cy, factor));
    },
    [bodyRef],
  );

  const reset = useCallback(() => setView({ x: base.x, y: base.y, scale: base.scale }), [base.x, base.y, base.scale]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !active) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = body.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * WHEEL_STEP);
      setView((v) => zoomAround(v, event.clientX - rect.left, event.clientY - rect.top, factor));
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, [bodyRef, active]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, origin: view, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return { view, dragging, zoomBy, reset, bind: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag } };
}
