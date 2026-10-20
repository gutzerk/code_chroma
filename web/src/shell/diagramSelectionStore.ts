import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

const EMPTY: readonly string[] = [];

/** Which diagram layers are ticked in the Diagrams tab (the input to "Arrange selected"). */
class DiagramSelectionStore extends Store {
  private selected: readonly string[] = EMPTY;

  getSelected = (): readonly string[] => this.selected;

  toggle = (layer: string): void => {
    this.selected = this.selected.includes(layer)
      ? this.selected.filter((l) => l !== layer)
      : [...this.selected, layer];
    this.emit();
  };

  /** Drops layers that no longer exist so a deleted diagram can't stay selected. */
  prune = (existing: readonly string[]): void => {
    const next = this.selected.filter((l) => existing.includes(l));
    if (next.length === this.selected.length) return;
    this.selected = next.length === 0 ? EMPTY : next;
    this.emit();
  };

  reset = (): void => {
    if (this.selected === EMPTY) return;
    this.selected = EMPTY;
    this.emit();
  };
}

export const diagramSelectionStore = new DiagramSelectionStore();

export function useSelectedLayers(): readonly string[] {
  return useSyncExternalStore(diagramSelectionStore.subscribe, diagramSelectionStore.getSelected);
}
