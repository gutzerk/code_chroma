import { useCallback, useEffect, useRef, useState } from "react";

export interface MeasuredBoxSize {
  width: number;
  height: number;
  /** The box's own CSS margin-left/-top, in px. A box positioned via `position: absolute; left/top`
   * with a non-zero margin renders its border-box shifted right/down from those coordinates by
   * exactly this much (CSS: 'left' places the *margin* edge, not the border edge) — callers that
   * reconstruct a box's rect from its `left`/`top` position (CanvasEdges) need this added back in,
   * or every anchor on a margined box (e.g. `.block`'s 0.4rem) lands off by a constant amount. Zero
   * for a margin-less box (e.g. `.diagram-node-box`), so this is a safe no-op there. Optional so a
   * caller with its own narrower `T` (TopLevelChildren's `TopLevelBoxSize`, width/height only) isn't
   * forced to carry fields it has no use for. */
  marginLeft?: number;
  marginTop?: number;
}

export interface UseMeasuredSizesOptions {
  onResize?: () => void;
}

/** One shared ResizeObserver over a set of rendered boxes: reports each box's real border-box size
 * (immune to the camera's zoom scale) so a dagre layout can re-rank around a box's actual footprint
 * instead of a fixed default. No-op size updates are filtered, so dragging a box never triggers a
 * relayout. `onResize` (rAF-coalesced) is for callers whose boxes are `position: absolute` and so
 * never trip their container's own ResizeObserver — C1View and TopLevelChildren use it to bump
 * `canvasLayoutStore` so their DOM-measured arrow overlays re-measure; Epics/Patterns omit it since
 * their edges recompute from this hook's own `sizes` state already. jsdom has no ResizeObserver —
 * unit tests simply keep the default box sizes. */
export function useMeasuredSizes<T extends MeasuredBoxSize = MeasuredBoxSize>(
  options?: UseMeasuredSizesOptions
): {
  sizes: ReadonlyMap<string, T>;
  observe: (id: string, element: HTMLElement | null) => void;
} {
  const [sizes, setSizes] = useState<ReadonlyMap<string, T>>(new Map());
  const idByElement = useRef(new Map<Element, string>());
  const elementById = useRef(new Map<string, Element>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const bumpFrameRef = useRef(0);
  const onResizeRef = useRef(options?.onResize);
  onResizeRef.current = options?.onResize;

  useEffect(() => () => cancelAnimationFrame(bumpFrameRef.current), []);

  const observe = useCallback((id: string, element: HTMLElement | null) => {
    if (typeof ResizeObserver === "undefined") return;
    const previous = elementById.current.get(id);
    if (previous && previous !== element) {
      observerRef.current?.unobserve(previous);
      idByElement.current.delete(previous);
      elementById.current.delete(id);
    }
    observerRef.current ??= new ResizeObserver((entries) => {
      const onResize = onResizeRef.current;
      if (onResize) {
        cancelAnimationFrame(bumpFrameRef.current);
        bumpFrameRef.current = requestAnimationFrame(onResize);
      }
      setSizes((previous) => {
        let next: Map<string, T> | null = null;
        for (const entry of entries) {
          const entryId = idByElement.current.get(entry.target);
          if (!entryId) continue;
          const borderBox = entry.borderBoxSize?.[0];
          const target = entry.target as HTMLElement;
          const size = borderBox
            ? { width: Math.round(borderBox.inlineSize), height: Math.round(borderBox.blockSize) }
            : { width: target.offsetWidth, height: target.offsetHeight };
          if (size.width === 0 || size.height === 0) continue;
          const style = getComputedStyle(target);
          const measured = {
            ...size,
            marginLeft: Math.round(parseFloat(style.marginLeft) || 0),
            marginTop: Math.round(parseFloat(style.marginTop) || 0),
          };
          const current = previous.get(entryId);
          if (
            current?.width === measured.width &&
            current?.height === measured.height &&
            current?.marginLeft === measured.marginLeft &&
            current?.marginTop === measured.marginTop
          )
            continue;
          next ??= new Map(previous);
          next.set(entryId, measured as T);
        }
        return next ?? previous;
      });
    });
    if (element) {
      idByElement.current.set(element, id);
      elementById.current.set(id, element);
      observerRef.current.observe(element);
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { sizes, observe };
}
