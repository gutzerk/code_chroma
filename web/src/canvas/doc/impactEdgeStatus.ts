import { useSyncExternalStore } from "react";
import { impactChangesSidecarStore } from "../../state/useSidecar";
import type { CanvasDoc, ImpactChanges } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { stringMeta } from "./elementMeta";

/** The ids one element answers to in a relationship: its canvas id, graph node id and recipe key. */
export function aliasesOf(doc: CanvasDoc, elementId: string): string[] {
  const element = doc.elements[elementId];
  if (!element) return [elementId];
  return [element.id, element.node_id ?? "", stringMeta(element, "recipe_key") ?? ""].filter(Boolean);
}

const authoredRemoved = new WeakMap<CanvasDoc["edges"], boolean>();
const reviewRemoved = new WeakMap<ImpactChanges["relationships"], boolean>();

/** Whether any edge/relationship of this doc/change could be a removed link; cached so ordinary diagrams skip the per-edge scans. */
function mayHaveRemovedLinks(changes: ImpactChanges, doc: CanvasDoc): boolean {
  let authored = authoredRemoved.get(doc.edges);
  if (authored === undefined) {
    authored = Object.values(doc.edges).some((edge) => edge.kind === "removed");
    authoredRemoved.set(doc.edges, authored);
  }
  let reviewed = reviewRemoved.get(changes.relationships);
  if (reviewed === undefined) {
    reviewed = changes.relationships.some((rel) => rel.status === "removed");
    reviewRemoved.set(changes.relationships, reviewed);
  }
  return authored || reviewed;
}

/** True when the arrow is authored `kind: "removed"`, or the review lists it as a link the change removed. */
export function isRemovedLink(changes: ImpactChanges, doc: CanvasDoc, from: string | null, to: string | null): boolean {
  if (!from || !to || !mayHaveRemovedLinks(changes, doc)) return false;
  const fromIds = aliasesOf(doc, from);
  const toIds = aliasesOf(doc, to);
  const authored = Object.values(doc.edges).some(
    (edge) => edge.kind === "removed" && fromIds.includes(edge.from) && toIds.includes(edge.to),
  );
  return authored || changes.relationships.some(
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
