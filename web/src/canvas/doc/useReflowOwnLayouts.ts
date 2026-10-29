import { useEffect, useRef } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasDoc } from "../../state/types";
import { patchCanvasDoc } from "./canvasDocStore";
import { layersWithProfile } from "./diagramProfiles";

/** Once per mount, after the doc loads: rewrites persisted geometry that drifted from its profile's own layout (a sequence board). */
export function useReflowOwnLayouts(engineClient: EngineClient, doc: CanvasDoc, loaded: boolean): void {
  // Such layers are locked-layout, so one pass over the loaded doc is enough; an earlier pass would only see the empty doc.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current || !loaded) return;
    checkedRef.current = true;
    const byLayer = layersWithProfile(Object.values(doc.elements), "layout");
    if (byLayer.size === 0) return;

    // Write only the elements whose persisted geometry disagrees with their layer's self-contained layout.
    const ops = [];
    for (const { profile, ids } of byLayer.values()) {
      const { positions, sizes } = profile.layout(doc, ids);
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

    // Best-effort on load: a failed re-spread is a cosmetic stale layout, never an unhandled rejection.
    void patchCanvasDoc(engineClient, ops, {
      explanation: "re-spread board layers to current layout constants",
    }).catch(() => {});
  }, [engineClient, doc, loaded]);
}
