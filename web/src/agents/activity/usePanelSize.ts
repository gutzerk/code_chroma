import { useEffect, useState, type RefObject } from "react";
import { layoutForWidth } from "../../workflows/runControls";

export type PanelSize = "default" | "side" | "full";

const PANEL_PADDING = 24;

/** The panel's size class from its own width (so a hand-dragged panel adapts like the stretched and full ones). */
export function usePanelSize(panelRef: RefObject<HTMLElement | null>): PanelSize {
  const [size, setSize] = useState<PanelSize>("default");
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const apply = (width: number): void => {
      const layout = layoutForWidth(width - PANEL_PADDING);
      const next: PanelSize = layout === "full" ? "full" : layout === "side" ? "side" : "default";
      setSize((prev) => (prev === next ? prev : next));
    };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width;
      apply(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [panelRef]);
  return size;
}
