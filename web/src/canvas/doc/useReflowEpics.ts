import { useEffect, useRef } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasDoc } from "../../state/types";
import { patchCanvasDoc } from "./canvasDocStore";
import { isEpicsLayerName, layoutEpics, type MeasuredHeights } from "./epicsLayout";

/** The fit this fixes (epics boxes): a box's persisted `size.h` can disagree with its real rendered
 * height in two directions. An under-reserved content card (a «Спеки»/Acceptance/Summary card whose
 * `fitContentHeight` estimate was short) grows UP — epics boxes are bottom-left positioned with
 * `minHeight` + overflow — and lands on the box above. An over-reserved box (the root epic title, or
 * a card sized before a shorter text was fitted) keeps an empty dark band below its text. This
 * re-fits each box to its real content height (from `epicsContentSizeStore`) and re-lays-out at that
 * footprint so the persisted `size.h` matches what's rendered: nothing overlaps and nothing leaves a
 * dead band. */
const MIN_DELTA = 2;

/** One-shot post-mount reflow for the epics layer: when a box's real *content* height differs from
 * its persisted `element.size.h` by more than `MIN_DELTA` (taller OR shorter), re-run `layoutEpics`
 * with the measured heights and persist the corrected `size`/`position`. The content height — not
 * the box border-box measurement — is the source of truth: `.diagram-node-box` pins `minHeight` to
 * the reserved height, so an over-reserved box's border-box always equals the reservation even when
 * its text is shorter (the dark band is invisible to a border-box observer). Every epics-layer box
 * with a persisted height is a candidate — the render-kind-fixed root epic/spec/task boxes included,
 * since only the reflow supplies their shrink-to-content height (see `layoutEpics`); a too-tall card
 * still grows to prevent overlap. Runs once per mismatch — the corrected `size.h` makes the next
 * check pass, so the reflow cannot re-fire. jsdom reports 0-height content, which is filtered out,
 * so unit tests never trigger this. */
export function useReflowEpics(
  engineClient: EngineClient,
  doc: CanvasDoc,
  contentSizes: ReadonlyMap<string, { height: number }>,
): void {
  const patchingRef = useRef(false);

  useEffect(() => {
    // Gate each candidate on the epics layer so a same-shape card in another diagram (e.g. a pattern
    // brief with a summary meta) can't be dragged into re-layout here — the layer check, not
    // `isEpicsLayer` (whose epic/group render gate misses the spec/task content cards the layout also
    // places). A box must have a persisted height to be re-fitted: the reflow compares against it, and
    // a box with none is placed from scratch on first draw anyway.
    const mismatches: string[] = [];
    let layer: string | undefined;
    for (const [id, measured] of contentSizes) {
      if (measured.height === 0) continue;
      const element = doc.elements[id];
      if (!element) continue;
      if (!isEpicsLayerName(element.layer)) continue;
      if (element.render === "group") continue;
      const reserved = element.size?.h;
      // Shrink (over-reserved → dark band) qualifies exactly like grow (under-reserved → overlap).
      if (reserved && Math.abs(measured.height - reserved) > MIN_DELTA) {
        mismatches.push(id);
        layer = element.layer;
      }
    }
    if (mismatches.length === 0 || patchingRef.current || layer === undefined) return;

    const layerIds = Object.entries(doc.elements)
      .filter(([, e]) => e.layer === layer)
      .map(([id]) => id);

    const measuredHeights: MeasuredHeights = {};
    for (const id of mismatches) {
      const m = contentSizes.get(id);
      if (m) measuredHeights[id] = m.height;
    }

    patchingRef.current = true;
    const { positions, sizes } = layoutEpics(doc, layerIds, measuredHeights);
    // `layoutEpics` lays out at y=0; `layoutNewElements` shifts the whole layer below whatever was
    // already on the canvas by a constant `yOffset`. Preserve that anchor or the reflow would jump the
    // whole epics layer up to y=0 and over the boxes above it. Anchor on the layer's topmost box by
    // its TOP edge (`position.y - height`), not a box whose size happened to stay the same: every
    // column starts at y=0 here, so a root's laid-out top is 0 and its current top is exactly
    // `yOffset` -- and this stays correct even when the root itself shrinks (a bottom-edge anchor on
    // an unchanged lower box would drag the whole column down by the shrink amount).
    let anchorId: string | null = null;
    let anchorTop = Infinity;
    for (const [id, position] of Object.entries(positions)) {
      const newSize = sizes[id];
      if (!newSize) continue; // group frames carry no persisted size -- never an anchor
      const top = position.y - newSize.h;
      if (top < anchorTop) {
        anchorTop = top;
        anchorId = id;
      }
    }
    const anchorEl = anchorId ? doc.elements[anchorId] : undefined;
    const currentTop = anchorEl?.size ? anchorEl.position.y - anchorEl.size.h : 0;
    const yOffset = anchorId ? currentTop - anchorTop : 0;
    const ops = Object.entries(positions).map(([id, position]) => ({
      op: "update_element" as const,
      id,
      position: { x: position.x, y: position.y + yOffset },
      ...(sizes[id] ? { size: sizes[id] } : {}),
    }));
    if (ops.length > 0) {
      void patchCanvasDoc(engineClient, ops, { explanation: "reflow epics content to measured height" }).finally(
        () => {
          patchingRef.current = false;
        },
      );
    } else {
      patchingRef.current = false;
    }
  }, [engineClient, doc, contentSizes]);
}
