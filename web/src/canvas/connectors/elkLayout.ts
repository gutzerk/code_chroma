import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { NODE_SEP, RANK_SEP } from "../collision/constants";
import { leadingOrderDigits } from "../doc/elementMeta";
import type { LayoutBoxSpec, PositionedBox } from "./diagramLayout";

/** Directed edge shape `layoutBoxes()` accepts; `kind` is accepted for parity but never affects layout. */
export interface LayoutEdge {
  from: string;
  to: string;
  kind?: string;
}

/** Outer canvas margin. */
const MARGIN = 40;

const elk = new ELK();

/** Authored `order` ("1", "2a") as a 0-indexed rank; no leading digits means no order. */
function parseOrderRank(order: string | undefined): number | undefined {
  const digits = leadingOrderDigits(order);
  if (digits === undefined) return undefined;
  const rank = Number.parseInt(digits, 10) - 1;
  if (rank < 0) console.warn(`meta.order "${order}" is out of range (Order is 1-indexed) -- treating as "1"`);
  return Math.max(0, rank);
}

/** Structural edges with `order` made authoritative: an edge against the authored order is dropped, and every box of one order is chained above every box of the next. */
function applyOrder(nodes: readonly LayoutBoxSpec[], edges: readonly LayoutEdge[]): LayoutEdge[] {
  const rankOf = new Map<string, number>();
  for (const node of nodes) {
    const rank = parseOrderRank(node.order);
    if (rank !== undefined) rankOf.set(node.id, rank);
  }
  const kept = edges.filter((edge) => {
    const from = rankOf.get(edge.from);
    const to = rankOf.get(edge.to);
    return from === undefined || to === undefined || from <= to;
  });
  const byRank = new Map<number, string[]>();
  for (const [id, rank] of rankOf) byRank.set(rank, [...(byRank.get(rank) ?? []), id]);
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const chain: LayoutEdge[] = [];
  ranks.slice(1).forEach((rank, index) => {
    for (const from of byRank.get(ranks[index]) ?? []) {
      for (const to of byRank.get(rank) ?? []) chain.push({ from, to });
    }
  });
  return [...kept, ...chain];
}

/** Pulls same-lane boxes adjacent (a lane sits where its earliest member is); ELK's model-order option keeps that input order within a layer. */
function clusterByLane(nodes: readonly LayoutBoxSpec[]): LayoutBoxSpec[] {
  const firstIndexOfLane = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (node.lane && !firstIndexOfLane.has(node.lane)) firstIndexOfLane.set(node.lane, index);
  });
  return nodes
    .map((node, index) => ({ node, index, cluster: firstIndexOfLane.get(node.lane ?? "") ?? index }))
    .sort((a, b) => a.cluster - b.cluster || a.index - b.index)
    .map((entry) => entry.node);
}

/** Lays boxes out with ELK's layered algorithm: a one-directional edge puts its source above its target, `order` pins layers via ordering edges, `lane` clusters via input order. */
export async function computeElkLayout(
  nodes: readonly LayoutBoxSpec[],
  edges: readonly LayoutEdge[],
): Promise<{ boxes: PositionedBox[]; width: number; height: number }> {
  if (nodes.length === 0) return { boxes: [], width: 600, height: 400 };

  const idSet = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const elkEdges = applyOrder(nodes, edges)
    .filter((edge) => idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to)
    .filter((edge) => {
      const key = JSON.stringify([edge.from, edge.to]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((edge, index) => ({ id: `e${index}`, sources: [edge.from], targets: [edge.to] }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": String(NODE_SEP),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(RANK_SEP),
      "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.componentComponent": String(NODE_SEP),
      "elk.separateConnectedComponents": "true",
      "elk.aspectRatio": "1.6",
    },
    children: clusterByLane(nodes).map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: elkEdges,
  };

  const laidOut = await elk.layout(graph);
  const placed = new Map((laidOut.children ?? []).map((child) => [child.id, child]));
  const boxes = nodes.map((node) => {
    const child = placed.get(node.id);
    return {
      id: node.id,
      x: (child?.x ?? 0) + node.width / 2,
      y: (child?.y ?? 0) + node.height / 2,
      width: node.width,
      height: node.height,
    };
  });
  return { boxes, width: laidOut.width ?? 600, height: laidOut.height ?? 400 };
}
