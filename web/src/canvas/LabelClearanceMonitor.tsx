import { useEffect } from "react";
import { BLOCK_HEADER_SELECTOR, OVERLAY_SETTLE_FRAMES } from "./canvasOverlay";
import { findOverlaps } from "./connectors/labelClearance";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";

/** A friendly id for a console warning: the caption text for a chip, the node id for a box. */
function idOf(element: Element): string {
  if (element.classList.contains("connector-label-chip")) {
    const text = element.nextElementSibling?.textContent?.trim();
    return `label:${text || "?"}`;
  }
  const nodeId = element.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
  return `box:${nodeId ?? "?"}`;
}

/** Dev-only detector: after layout settles, checks whether any edge-label chip overlaps another
 * chip or a box, and warns so dense diagrams (Patterns, C1) don't clutter silently. v1 is detection
 * only -- no auto-reposition, per docs/planning/019's decision to keep box/label placement manual.
 * Renders nothing; it only reads the live DOM the other overlays already draw. Unlike an SVG overlay
 * (useOverlaySvgRef), there's no rendered output to keep in sync frame-by-frame, so this waits out
 * the settle window once and scans a single time instead of rescanning on every settle frame. */
export function LabelClearanceMonitor() {
  const layoutVersion = useCanvasLayoutVersion();

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const check = () => {
      const chips = Array.from(document.querySelectorAll<Element>(".connector-label-chip"));
      const boxes = Array.from(document.querySelectorAll<Element>(BLOCK_HEADER_SELECTOR));
      const rects = [...chips, ...boxes]
        .map((element) => ({ id: idOf(element), box: element.getBoundingClientRect() }))
        .filter((rect) => rect.box.width > 0 && rect.box.height > 0);

      const clashes = findOverlaps(rects);
      if (clashes.length > 0) {
        console.warn(
          `[label-clearance] ${clashes.length} label clash${clashes.length === 1 ? "" : "es"}:`,
          clashes,
        );
      }
    };

    let raf = 0;
    let remaining = OVERLAY_SETTLE_FRAMES;
    const settle = () => {
      remaining -= 1;
      if (remaining > 0) {
        raf = requestAnimationFrame(settle);
        return;
      }
      check();
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", check);
    };
  }, [layoutVersion]);

  return null;
}
