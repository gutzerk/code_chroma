import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import { impactChangesSidecarStore } from "../../state/useSidecar";
import type { CanvasDoc, CanvasElement, ImpactBlockChange } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { stringMeta } from "./elementMeta";
import { boxKindOf, collapseKindOf, summarizeImpact, type CollapseKind, type ImpactBoxKind } from "./impactGlanceLogic";

/** Boxes the user opened out of their pill, by element id. */
class ImpactExpandStore extends Store {
  private open = new Set<string>();
  has = (id: string): boolean => this.open.has(id);
  expand = (id: string): void => {
    this.open = new Set(this.open).add(id);
    this.emit();
  };
  reset(): void {
    this.open = new Set();
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
}

function computeKey(element: CanvasElement, change: ImpactBlockChange | undefined, enabled: boolean): string {
  if (!enabled) return "||";
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
  return `${boxKindOf(authored, change) ?? ""}|${collapse ?? ""}|${biggest ? "1" : ""}`;
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
  const [kind, collapse, biggest] = key.split("|");
  return {
    kind: (kind || null) as ImpactBoxKind | null,
    collapse: (collapse || null) as CollapseKind | null,
    biggest: biggest === "1",
  };
}
