import { patchCanvasDoc } from "../canvas/doc/canvasDocStore";
import type { EngineClient } from "../engine-client/EngineClient";

const GAP = 160;
const DEFAULT_WIDTH = 240;

/** Slides a freshly drawn layer so it sits to the right of every other diagram instead of over it. */
export async function placeLayerRightOfOthers(engineClient: EngineClient, layer: string): Promise<void> {
  const doc = await engineClient.getCanvas();
  const all = Object.values(doc.elements);
  const mine = all.filter((element) => element.layer === layer);
  const others = all.filter((element) => element.layer !== layer);
  if (mine.length === 0 || others.length === 0) return;
  const right = (e: (typeof all)[number]) => e.position.x + (e.size?.w ?? DEFAULT_WIDTH) / 2;
  const left = (e: (typeof all)[number]) => e.position.x - (e.size?.w ?? DEFAULT_WIDTH) / 2;
  const shift = Math.max(...others.map(right)) + GAP - Math.min(...mine.map(left));
  if (shift <= 0) return;
  const ops = mine.map((element) => ({
    op: "update_element" as const,
    id: element.id,
    position: { x: element.position.x + shift, y: element.position.y },
  }));
  await patchCanvasDoc(engineClient, ops, { layer, explanation: "place beside the first diagram" });
}
