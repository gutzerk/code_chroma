import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { stringMeta } from "./elementMeta";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";
import type { UnionBounds } from "./boundingBox";
import { containerPathOf } from "../strategies/nodeCopyText";

/** The Impact board's card and folder geometry (design board "ImpactGlance"). */
export const IMPACT_CARD = { w: 260, h: 96 } as const;
// One card per row: arrows inside a folder run downward and their labels sit in the row gaps, clear of the cards.
const CARD_GAP_Y = 52;
export const FOLDER_PAD = { side: 20, top: 48, bottom: 22 } as const;
const FOLDER_GAP_X = 120;
const FOLDER_GAP_Y = 20;
export const FOLDER_WIDTH = FOLDER_PAD.side * 2 + IMPACT_CARD.w;
/** The summary bar above the folders and the "outside this slice" strip below them. */
export const BOARD_BAR = { height: 64, gap: 20, outside: 40 } as const;

/** The board frame around the folders' union: the summary bar above, the outside strip below -- shared by the profile frame and the chrome. */
export function impactFrameBounds(base: UnionBounds): UnionBounds {
  const left = base.left - FOLDER_PAD.side;
  return {
    left,
    top: base.top - FOLDER_PAD.top - BOARD_BAR.gap - BOARD_BAR.height,
    right: Math.max(base.right + FOLDER_PAD.side, left + FOLDER_WIDTH),
    bottom: base.bottom + FOLDER_PAD.bottom + BOARD_BAR.gap + BOARD_BAR.outside,
  };
}
const FRESH_MARGIN = 80;

export const IMPACT_LAYER = "impact";

/** The repo path a box stands for: `meta.path`, else its node id with the kind prefix and symbol suffix dropped. */
export function impactPathOf(element: CanvasElement): { path: string; isDir: boolean } | null {
  const authored = stringMeta(element, "path")?.trim();
  const nodeId = element.node_id ?? "";
  const isDir = nodeId.startsWith("dir::");
  const raw =
    authored ||
    (nodeId.startsWith("module::") ? nodeId.split("::")[1] : (containerPathOf(nodeId) ?? nodeId.split("::")[0]));
  return raw ? { path: raw.replace(/^\.?\/+|\/+$/g, ""), isDir } : null;
}

/** The folder a box lives in, as path segments. */
function folderSegments(element: CanvasElement): string[] | null {
  const located = impactPathOf(element);
  if (!located) return null;
  const segments = located.path.split("/").filter(Boolean);
  return located.isDir ? segments : segments.slice(0, -1);
}

function commonPrefix(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const segment = lists[0][i];
    if (segment === undefined || lists.some((list) => list[i] !== segment)) return out;
    out.push(segment);
  }
}

export interface ImpactFolder {
  /** Stable bucket key; also the tint seed via its top-level segment. */
  key: string;
  label: string;
  /** The folder's top-level segment, which picks its tint. */
  area: string;
  ids: string[];
}

/** Buckets the layer's boxes into top-level areas (two path segments), folding lone boxes of one area together. */
export function impactFoldersOf(elements: readonly CanvasElement[]): ImpactFolder[] {
  const buckets = new Map<string, { ids: string[]; dirs: string[][] }>();
  const add = (key: string, id: string, dir: string[]) => {
    const bucket = buckets.get(key) ?? { ids: [], dirs: [] };
    bucket.ids.push(id);
    bucket.dirs.push(dir);
    buckets.set(key, bucket);
  };
  for (const element of elements) {
    const dir = folderSegments(element);
    add(dir ? dir.slice(0, 2).join("/") : "\u0000other", element.id, dir ?? []);
  }
  const loners = new Map<string, string[]>();
  for (const [key, bucket] of buckets) {
    if (bucket.ids.length !== 1 || key.startsWith("\u0000") || !key.includes("/")) continue;
    const top = key.split("/")[0];
    loners.set(top, [...(loners.get(top) ?? []), key]);
  }
  for (const [top, keys] of loners) {
    if (keys.length < 2) continue;
    for (const key of keys) {
      const bucket = buckets.get(key)!;
      buckets.delete(key);
      add(top, bucket.ids[0], bucket.dirs[0]);
    }
  }
  return [...buckets].map(([key, { ids, dirs }]) => {
    if (key.startsWith("\u0000")) return { key, label: "other", area: "other", ids };
    const prefix = commonPrefix(dirs);
    const label = (prefix.length > 0 ? prefix : key.split("/")).join("/") || "(repo root)";
    return { key, label, area: key.split("/")[0] || "root", ids };
  });
}

/** Longest-path rank of each box along the layer's arrows, so folders and cards read in flow order. */
function flowRanks(ids: readonly string[], doc: CanvasDoc): Map<string, number> {
  const idSet = new Set(ids);
  const edges = Object.values(doc.edges).filter((edge) => idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to);
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const edge of edges) {
      const next = (rank.get(edge.from) ?? 0) + 1;
      if (next > (rank.get(edge.to) ?? 0) && next < ids.length) {
        rank.set(edge.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return rank;
}

function isLaidOut(element: CanvasElement): boolean {
  return element.position.x !== 0 || element.position.y !== 0;
}

/** The layer's boxes the board arranges (every Impact box; notes and groups keep their own place). */
export function impactBoardElements(doc: CanvasDoc, ids: readonly string[]): CanvasElement[] {
  const layers = new Set(ids.map((id) => doc.elements[id]?.layer).filter(Boolean));
  return Object.values(doc.elements).filter((element) => layers.has(element.layer) && element.render === "impact");
}

/** Top-left of the folder area: the current board's own corner, or below the rest of the canvas on a fresh draw. */
function anchorOf(doc: CanvasDoc, boxes: readonly CanvasElement[]): CanvasPosition {
  const placed = boxes.filter(isLaidOut);
  if (placed.length > 0) {
    const left = Math.min(...placed.map((box) => box.position.x - (box.size?.w ?? DEFAULT_ELEMENT_SIZE.w) / 2));
    const top = Math.min(...placed.map((box) => box.position.y - (box.size?.h ?? DEFAULT_ELEMENT_SIZE.h) / 2));
    return { x: left - FOLDER_PAD.side, y: top - FOLDER_PAD.top };
  }
  const ids = new Set(boxes.map((box) => box.id));
  const others = Object.values(doc.elements).filter((element) => !ids.has(element.id) && element.render !== "group");
  if (others.length === 0) return { x: 0, y: 0 };
  const bottom = Math.max(...others.map((element) => element.position.y + (element.size?.h ?? DEFAULT_ELEMENT_SIZE.h) / 2));
  const left = Math.min(...others.map((element) => element.position.x - (element.size?.w ?? DEFAULT_ELEMENT_SIZE.w) / 2));
  return { x: left, y: bottom + FRESH_MARGIN + BOARD_BAR.height + BOARD_BAR.gap * 2 };
}

/** Deterministic Impact board: folders of 260x96 cards, folders packed into columns in flow order. */
export function layoutImpactBoard(
  doc: CanvasDoc,
  ids: readonly string[],
): { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> } {
  const positions: Record<string, CanvasPosition> = {};
  const sizes: Record<string, CanvasSize> = {};
  const boxes = impactBoardElements(doc, ids);
  if (boxes.length === 0) return { positions, sizes };
  const anchor = anchorOf(doc, boxes);
  const ranks = flowRanks(boxes.map((box) => box.id), doc);
  const byId = new Map(boxes.map((box) => [box.id, box] as const));
  const order = (a: string, b: string) =>
    (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0) || (byId.get(a)?.label ?? "").localeCompare(byId.get(b)?.label ?? "");
  const folders = impactFoldersOf(boxes)
    .map((folder) => ({ ...folder, ids: [...folder.ids].sort(order) }))
    .sort((a, b) => Math.min(...a.ids.map((id) => ranks.get(id) ?? 0)) - Math.min(...b.ids.map((id) => ranks.get(id) ?? 0)) || a.label.localeCompare(b.label));
  const columns = Math.min(folders.length, folders.length <= 4 ? 3 : 4);
  const heights = new Array<number>(columns).fill(0);
  for (const folder of folders) {
    const column = heights.indexOf(Math.min(...heights));
    const rows = folder.ids.length;
    const originX = anchor.x + column * (FOLDER_WIDTH + FOLDER_GAP_X) + FOLDER_PAD.side;
    const originY = anchor.y + heights[column] + FOLDER_PAD.top;
    folder.ids.forEach((id, row) => {
      positions[id] = { x: originX + IMPACT_CARD.w / 2, y: originY + row * (IMPACT_CARD.h + CARD_GAP_Y) + IMPACT_CARD.h / 2 };
      sizes[id] = { w: IMPACT_CARD.w, h: IMPACT_CARD.h };
    });
    heights[column] += FOLDER_PAD.top + rows * IMPACT_CARD.h + (rows - 1) * CARD_GAP_Y + FOLDER_PAD.bottom + FOLDER_GAP_Y;
  }
  return { positions, sizes };
}

/** True while any Impact box still has its pre-board size, so the board re-spreads once and never fights a drag. */
export function impactBoardNeedsReflow(doc: CanvasDoc, ids: readonly string[]): boolean {
  return impactBoardElements(doc, ids).some((box) => box.size?.w !== IMPACT_CARD.w || box.size?.h !== IMPACT_CARD.h);
}
