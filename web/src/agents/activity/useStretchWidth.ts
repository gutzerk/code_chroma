import { useEffect, useState, type RefObject } from "react";
import { agentsWideWidth } from "../../canvas/layout/layoutMetrics";

/** Pixel width for the stretched panel, tracking the surrounding canvas area; null when inactive. */
export function useStretchWidth(
  panelRef: RefObject<HTMLElement | null>,
  active: boolean,
  leftOpen: boolean,
): number | null {
  const [areaWidth, setAreaWidth] = useState<number | null>(null);
  useEffect(() => {
    const area = active ? panelRef.current?.closest<HTMLElement>(".canvas-area") : null;
    if (!area) return;
    const measure = () => {
      const next = Math.round(area.clientWidth);
      setAreaWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [active, panelRef]);
  if (!active || areaWidth === null) return null;
  return agentsWideWidth(areaWidth, leftOpen, true);
}
