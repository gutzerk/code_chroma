import { useEffect, useRef } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasDoc } from "../../state/types";
import { patchCanvasDoc } from "./canvasDocStore";
import { layoutSequence } from "./autoLayout";

/**
 * One-shot re-spread of every sequence layer's persisted geometry to the current `SEQUENCE_LAYOUT`
 * constants, on mount. A sequence layer is locked-layout (never user-dragged), so its `position`/`size`
 * are pure derivations of the layout constants — yet those values are persisted. When a constant
 * changes (colW, headGap, rowH…), an already-drawn layer keeps its stale geometry and never picks up
 * the new spread, which read as "the fix doesn't work" until the user redraws. Re-running the layout
 * on load closes that gap: the layer re-spreads from `meta` alone, so whatever constants are current
 * govern the picture on every reload. Only sends writes when something actually moved, so an
 * up-to-date layer is untouched. Runs once per distinct persisted geometry per mount.
 */
export function useReflowSequence(engineClient: EngineClient, doc: CanvasDoc): void {
  // Runs once on mount, then never again: `SEQUENCE_LAYOUT` is a module const that never mutates and
  // sequence layers are locked-layout (never user-dragged), so geometry cannot become stale after the
  // first pass -- re-scanning on every `doc` change (each drag commit / patch refetch / live ping
  // rebuilds `doc`) would repeat the full no-op staleness scan forever.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    // Collect every sequence layer's member ids in layer order.
    const byLayer = new Map<string, string[]>();
    for (const [id, element] of Object.entries(doc.elements)) {
      if (element.render !== "sequence") continue;
      const list = byLayer.get(element.layer);
      if (list) list.push(id);
      else byLayer.set(element.layer, [id]);
    }
    if (byLayer.size === 0) return;

    // One pass per layer: lay out, then write only the elements whose persisted geometry disagrees
    // with the layout's (skipping ones the run would just overwrite identically). Each layer's layout
    // is self-contained (layoutSequence positions are absolute in the document -- no yOffset to
    // re-apply, unlike epics which lays out at y=0).
    const ops = [];
    for (const [, ids] of byLayer) {
      const { positions, sizes } = layoutSequence(doc, ids);
      for (const id of ids) {
        const p = positions[id];
        const s = sizes[id];
        const el = doc.elements[id];
        if (!el || !p || !s) continue;
        const drifting =
          Math.abs(el.position.x - p.x) > 0.01 ||
          Math.abs(el.position.y - p.y) > 0.01 ||
          Math.abs((el.size?.w ?? 0) - s.w) > 0.01 ||
          Math.abs((el.size?.h ?? 0) - s.h) > 0.01;
        if (!drifting) continue;
        ops.push({
          op: "update_element" as const,
          id,
          position: { x: p.x, y: p.y },
          size: s,
        });
      }
    }
    if (ops.length === 0) return;

    // Best-effort on load: a failed re-spread is a cosmetic stale layout, not something to surface
    // as an unhandled rejection on the read-only page-load path.
    void patchCanvasDoc(engineClient, ops, {
      explanation: "re-spread sequence layer to current layout constants",
    }).catch(() => {});
  }, [engineClient, doc]);
}
