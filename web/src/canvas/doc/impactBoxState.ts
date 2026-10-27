import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import { impactChangesSidecarStore } from "../../state/useSidecar";
import type { CanvasDoc, CanvasElement, ImpactBlockChange, ImpactChanges } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { stringMeta } from "./elementMeta";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";
import { boxKindOf, collapseKindOf, summarizeImpact, type CollapseKind, type ImpactBoxKind } from "./impactGlanceLogic";

/** Boxes the user opened out of their pill, by element id. */
class ImpactExpandStore extends Store {
  private open = new Set<string>();
  version = 0;
  has = (id: string): boolean => this.open.has(id);
  expand = (id: string): void => {
    this.expandAll([id]);
  };
  expandAll = (ids: readonly string[]): void => {
    this.open = new Set([...this.open, ...ids]);
    this.version += 1;
    this.emit();
  };
  reset(): void {
    this.open = new Set();
    this.version += 1;
    this.emit();
  }
}

export const impactExpandStore = new ImpactExpandStore();

const heroEndCache = new WeakMap<CanvasDoc["edges"], Set<string>>();

/** Element ids at either end of a hero edge, shared by every box per edges object. */
function heroEndsOf(doc: CanvasDoc): Set<string> {
  const cached = heroEndCache.get(doc.edges);
  if (cached) return cached;
  const ends = new Set<string>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.hero) {
      ends.add(edge.from);
      ends.add(edge.to);
    }
  }
  heroEndCache.set(doc.edges, ends);
  return ends;
}

export interface ImpactBoxState {
  kind: ImpactBoxKind | null;
  collapse: CollapseKind | null;
  biggest: boolean;
  /** "leader" draws the group's one merged pill, "hidden" draws nothing; null is a lone pill or box. */
  merge: "leader" | "hidden" | null;
}

/** One group's minor modified boxes folded into a single "N more modified" pill. */
export interface MergedPillGroup {
  leader: string;
  members: string[];
  names: string[];
}

export const MERGED_PILL_HEIGHT = 44;

let mergeCache: { elements: CanvasDoc["elements"]; changes: ImpactChanges; version: number; result: Map<string, MergedPillGroup> } | null = null;

/** Element id -> its merged group, for every minor collapsed box that shares a group with another one. */
export function mergedPillsOf(doc: CanvasDoc, changes: ImpactChanges): Map<string, MergedPillGroup> {
  if (mergeCache && mergeCache.elements === doc.elements && mergeCache.changes === changes && mergeCache.version === impactExpandStore.version) {
    return mergeCache.result;
  }
  const result = new Map<string, MergedPillGroup>();
  const hasChanges = changes.changed_file_count > 0 || changes.blocks.length > 0;
  if (hasChanges) {
    const summary = summarizeImpact(changes);
    const byBlock = new Map(changes.blocks.map((block) => [block.block, block] as const));
    const heroEnds = heroEndsOf(doc);
    const buckets = new Map<string, CanvasElement[]>();
    for (const element of Object.values(doc.elements)) {
      if (element.layer !== "impact" || impactExpandStore.has(element.id)) continue;
      const change = byBlock.get(stringMeta(element, "recipe_key") ?? "");
      if (!change) continue;
      const collapse = collapseKindOf({ authored: stringMeta(element, "status"), change, summary, hasChanges, isHeroEnd: heroEnds.has(element.id) });
      if (collapse !== "minor") continue;
      const key = element.group_id ?? "";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(element);
      else buckets.set(key, [element]);
    }
    for (const elements of buckets.values()) {
      if (elements.length < 2) continue;
      elements.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
      const group: MergedPillGroup = {
        leader: elements[0].id,
        members: elements.map((element) => element.id),
        names: elements.map((element) => element.label),
      };
      for (const element of elements) result.set(element.id, group);
    }
  }
  mergeCache = { elements: doc.elements, changes, version: impactExpandStore.version, result };
  return result;
}

/** The merged pill's rect (the leader's footprint, pill-tall), used to re-route arrows of hidden members. */
export function mergedPillRect(leader: CanvasElement): { left: number; top: number; width: number; height: number } {
  const width = leader.size?.w ?? DEFAULT_ELEMENT_SIZE.w;
  return { left: leader.position.x - width / 2, top: leader.position.y - MERGED_PILL_HEIGHT / 2, width, height: MERGED_PILL_HEIGHT };
}

/** Subscribes to everything the merge depends on and returns the current merged groups. */
export function useMergedPills(doc: CanvasDoc): Map<string, MergedPillGroup> {
  const subscribe = (listener: () => void) => {
    const stops = [impactChangesSidecarStore.subscribe(listener), impactExpandStore.subscribe(listener)];
    return () => stops.forEach((stop) => stop());
  };
  useSyncExternalStore(subscribe, () => `${impactExpandStore.version}|${impactChangesSidecarStore.getSnapshot().fingerprint}`);
  return mergedPillsOf(doc, impactChangesSidecarStore.getSnapshot());
}

function computeKey(element: CanvasElement, change: ImpactBlockChange | undefined, enabled: boolean): string {
  if (!enabled) return "|||";
  const changes = impactChangesSidecarStore.getSnapshot();
  const authored = stringMeta(element, "status");
  const summary = summarizeImpact(changes);
  const hasChanges = changes.changed_file_count > 0 || changes.blocks.length > 0;
  const collapse = impactExpandStore.has(element.id)
    ? null
    : collapseKindOf({
        authored,
        change,
        summary,
        hasChanges,
        isHeroEnd: heroEndsOf(canvasDocStore.getDoc()).has(element.id),
      });
  const biggest = change !== undefined && change.block === summary.biggest;
  const group = collapse === "minor" ? mergedPillsOf(canvasDocStore.getDoc(), changes).get(element.id) : undefined;
  const merge = group ? (group.leader === element.id ? "leader" : "hidden") : "";
  return `${boxKindOf(authored, change) ?? ""}|${collapse ?? ""}|${biggest ? "1" : ""}|${merge}`;
}

/** What the board's Impact treatment needs to know about one box: its chip kind, whether it folds into a pill, whether it is the biggest change. */
export function useImpactBoxState(
  element: CanvasElement,
  change: ImpactBlockChange | undefined,
  enabled: boolean,
): ImpactBoxState {
  const subscribe = (listener: () => void) => {
    const stops = [impactChangesSidecarStore.subscribe(listener), canvasDocStore.subscribe(listener), impactExpandStore.subscribe(listener)];
    return () => stops.forEach((stop) => stop());
  };
  const key = useSyncExternalStore(subscribe, () => computeKey(element, change, enabled));
  const [kind, collapse, biggest, merge] = key.split("|");
  return {
    kind: (kind || null) as ImpactBoxKind | null,
    collapse: (collapse || null) as CollapseKind | null,
    biggest: biggest === "1",
    merge: (merge || null) as ImpactBoxState["merge"],
  };
}
