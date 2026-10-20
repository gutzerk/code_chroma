import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

/** The last auto-draw failure from `useDiagramReadinessWatcher`, shown beside the Draw button. */
class DiagramWatcherErrorStore extends Store {
  private error: string | null = null;

  getError = (): string | null => this.error;

  set = (error: string | null): void => {
    if (this.error === error) return;
    this.error = error;
    this.emit();
  };

  reset = (): void => this.set(null);
}

export const diagramWatcherErrorStore = new DiagramWatcherErrorStore();

export function useDiagramWatcherError(): string | null {
  return useSyncExternalStore(diagramWatcherErrorStore.subscribe, diagramWatcherErrorStore.getError);
}
