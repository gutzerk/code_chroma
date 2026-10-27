import { useSyncExternalStore } from "react";
import { impactChangesSidecarStore } from "../../state/useSidecar";
import type { CanvasDoc, ImpactChanges } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { stringMeta } from "./elementMeta";

/** The ids one element answers to in a relationship: its canvas id, graph node id and recipe key. */
function aliasesOf(doc: CanvasDoc, elementId: string): string[] {
  const element = doc.elements[elementId];
  if (!element) return [elementId];
  return [element.id, element.node_id ?? "", stringMeta(element, "recipe_key") ?? ""].filter(Boolean);
}

/** True when the review lists the arrow between these two boxes as a link the change removed. */
export function isRemovedLink(changes: ImpactChanges, doc: CanvasDoc, from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  const fromIds = aliasesOf(doc, from);
  const toIds = aliasesOf(doc, to);
  return changes.relationships.some(
    (rel) =>
      rel.status === "removed" &&
      fromIds.some((id) => id === rel.from_node_id || id === rel.from) &&
      toIds.some((id) => id === rel.to_node_id || id === rel.to),
  );
}

/** Subscribes an arrow to whether the change removed the link it draws. */
export function useIsRemovedLink(from: string | null, to: string | null): boolean {
  return useSyncExternalStore(
    (listener) => {
      const stops = [impactChangesSidecarStore.subscribe(listener), canvasDocStore.subscribe(listener)];
      return () => stops.forEach((stop) => stop());
    },
    () => isRemovedLink(impactChangesSidecarStore.getSnapshot(), canvasDocStore.getDoc(), from, to),
  );
}
