import { useEffect, useRef } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasDoc } from "../../state/types";
import { patchCanvasDoc } from "./canvasDocStore";
import { layoutSequence } from "./autoLayout";

/** Once per mount, after the doc loads: rewrites persisted sequence geometry that drifted from the current board layout. */
export function useReflowSequence(engineClient: EngineClient, doc: CanvasDoc, loaded: boolean): void {
  // Sequence layers are locked-layout, so one pass over the loaded doc is enough; an earlier pass would only see the empty doc.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current || !loaded) return;
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
  }, [engineClient, doc, loaded]);
}
