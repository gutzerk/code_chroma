import { useEffect, useRef, useState, type RefObject } from "react";
import { layoutForWidth, type PanelLayout } from "./runControls";

/** Tracks the element's own width (not the viewport's) and maps it to a panel layout. */
export function useContainerLayout(): [RefObject<HTMLDivElement>, PanelLayout] {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<PanelLayout>("normal");
  const apply = (width: number): void => {
    const next = layoutForWidth(width);
    setLayout((prev) => (prev === next ? prev : next));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) apply(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, layout];
}
