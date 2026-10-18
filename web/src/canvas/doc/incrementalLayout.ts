import { resolveDrop, type Obstacle } from "../collision/resolveDrop";
import { computeElkLayout, type LayoutEdge } from "../connectors/elkLayout";
import type { LayoutBoxSpec } from "../connectors/diagramLayout";
import type { CanvasPosition } from "../../state/types";

export interface PinnedBox extends LayoutBoxSpec {
  /** Where the box sits now (centre) -- never changed, wherever the user dragged it. */
  position: CanvasPosition;
}

export interface IncrementalInput {
  pinned: readonly PinnedBox[];
  added: readonly LayoutBoxSpec[];
  edges: readonly LayoutEdge[];
  /** Everything else on the canvas a new box must not land on (other diagrams, user boxes). */
  obstacles: readonly Obstacle[];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Places only `added` boxes: ELK lays out pinned + added together, then each added box takes the offset (saved minus ELK position) of the pinned boxes it connects to, so it follows a diagram the user moved or rearranged. */
export async function placeIncrementally(input: IncrementalInput): Promise<Record<string, CanvasPosition>> {
  const { pinned, added, edges, obstacles } = input;
  const { boxes } = await computeElkLayout([...pinned, ...added], edges);
  const elkOf = new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y }]));

  const offsetOf = new Map<string, CanvasPosition>();
  for (const box of pinned) {
    const elk = elkOf.get(box.id) as CanvasPosition;
    offsetOf.set(box.id, { x: box.position.x - elk.x, y: box.position.y - elk.y });
  }
  const globalOffset = {
    x: median([...offsetOf.values()].map((o) => o.x)),
    y: median([...offsetOf.values()].map((o) => o.y)),
  };

  const neighboursOf = new Map<string, string[]>();
  for (const edge of edges) {
    for (const [self, other] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      if (offsetOf.has(other)) neighboursOf.set(self, [...(neighboursOf.get(self) ?? []), other]);
    }
  }

  const placedObstacles: Obstacle[] = [
    ...obstacles,
    ...pinned.map((box) => ({
      id: box.id,
      x: box.position.x - box.width / 2,
      y: box.position.y - box.height / 2,
      width: box.width,
      height: box.height,
    })),
  ];
  const positions: Record<string, CanvasPosition> = {};
  // Top-to-bottom, then left-to-right, so an earlier box keeps its spot and a later one yields.
  const ordered = [...added].sort((a, b) => {
    const pa = elkOf.get(a.id) as CanvasPosition;
    const pb = elkOf.get(b.id) as CanvasPosition;
    return pa.y - pb.y || pa.x - pb.x || (a.id < b.id ? -1 : 1);
  });
  for (const box of ordered) {
    const elk = elkOf.get(box.id) as CanvasPosition;
    const anchors = (neighboursOf.get(box.id) ?? []).map((id) => offsetOf.get(id) as CanvasPosition);
    const offset = anchors.length
      ? { x: mean(anchors.map((o) => o.x)), y: mean(anchors.map((o) => o.y)) }
      : globalOffset;
    const moving = {
      x: elk.x + offset.x - box.width / 2,
      y: elk.y + offset.y - box.height / 2,
      width: box.width,
      height: box.height,
    };
    const result = resolveDrop(moving, placedObstacles);
    positions[box.id] = { x: result.x + box.width / 2, y: result.y + box.height / 2 };
    placedObstacles.push({ id: box.id, ...moving, x: result.x, y: result.y });
  }
  return positions;
}
