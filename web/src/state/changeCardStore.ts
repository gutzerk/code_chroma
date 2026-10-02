import { useSyncExternalStore } from "react";
import type { ChangeCard } from "./types";
import { CardStore } from "./cardStore";
import { useVersion } from "./versionStore";

/** The deterministic change-card layer, keyed per node_id — the same CardStore the plan layer uses.
 * Published and cleared by refreshDiffs alongside diffOverlayStore, so the two halves of the Diff
 * toggle can never disagree about what changed. */
export const changeCardStore = new CardStore<ChangeCard>();

export function useChangeCards(nodeId: string): ChangeCard[] {
  return useSyncExternalStore(changeCardStore.subscribe, () => changeCardStore.getSteps(nodeId));
}

export function useAllChangeCards(): ChangeCard[] {
  return useSyncExternalStore(changeCardStore.subscribe, changeCardStore.getAllSteps);
}

export function useChangeCardGeometryVersion(): number {
  return useVersion(changeCardStore.geometry);
}
