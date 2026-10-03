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

// One element's current real border-box size (with its CSS margins), or null when the box isn't
// laid out yet (offsetWidth/Height can be 0 right after insertion) or has no real layout at all
// (jsdom returns 0 for both -- unit tests keep falling back to the model, as documented).
function measureNow(target: HTMLElement): MeasuredBoxSize | null {
  const width = target.offsetWidth;
  const height = target.offsetHeight;
  if (width === 0 || height === 0) return null;
  const style = getComputedStyle(target);
  return {
    width,
    height,
    marginLeft: Math.round(parseFloat(style.marginLeft) || 0),
    marginTop: Math.round(parseFloat(style.marginTop) || 0),
  };
}

// Merges one freshly-measured box into `sizes`, skipping it when nothing changed. Shared by the
// ResizeObserver callback (the async, later path) and the ref-callback's synchronous snapshot, so
// the same no-op filtering governs both.
function commitMeasurement<T extends MeasuredBoxSize>(
  previous: ReadonlyMap<string, T>,
  id: string,
  measured: MeasuredBoxSize,
): ReadonlyMap<string, T> {
  const current = previous.get(id);
  if (
    current?.width === measured.width &&
    current?.height === measured.height &&
    current?.marginLeft === measured.marginLeft &&
    current?.marginTop === measured.marginTop
  )
    return previous;
  const next = new Map(previous);
  next.set(id, measured as T);
  return next;
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
      setSizes((stale) => {
        let next: ReadonlyMap<string, T> = stale;
        for (const entry of entries) {
          const entryId = idByElement.current.get(entry.target);
          if (!entryId) continue;
          const borderBox = entry.borderBoxSize?.[0];
          const target = entry.target as HTMLElement;
          // A helper that folds margin into a plain width/height, so `getComputedStyle` runs exactly
          // once per box per path (the fallback below reuses `measureNow`'s own margin read).
          const withMargins = (size: { width: number; height: number }) => {
            const style = getComputedStyle(target);
            return {
              ...size,
              marginLeft: Math.round(parseFloat(style.marginLeft) || 0),
              marginTop: Math.round(parseFloat(style.marginTop) || 0),
            };
          };
          const measured = borderBox
            ? withMargins({ width: Math.round(borderBox.inlineSize), height: Math.round(borderBox.blockSize) })
            : measureNow(target);
          if (!measured) continue;
          next = commitMeasurement(next, entryId, measured);
        }
        return next;
      });
    });
    if (element) {
      idByElement.current.set(element, id);
      elementById.current.set(id, element);
      observerRef.current.observe(element);
      // Synchronous first measurement: a ref callback runs after the browser has applied CSS and
      // computed layout (before paint), so a box's real offsetWidth/Height are available here on the
      // same frame it mounts. Recording them now -- instead of waiting for the ResizeObserver's
      // async callback -- means arrows, group/lane/island frames and the page bounds all receive the
      // box's true footprint before the first paint, so nothing dressed-off-the-model lags for a
      // frame. jsdom's 0s are filtered by `measureNow`, leaving tests on the model fallback as ever.
      const immediate = measureNow(element);
      if (immediate) setSizes((previous) => commitMeasurement(previous, id, immediate));
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { sizes, observe };
}
