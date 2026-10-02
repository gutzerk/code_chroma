import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

/** Which epic's AI brief panel is open, if any — 016-single-canvas-dashboard Stage 4's stand-in for
 * the deleted EpicsView: clicking an "epic" canvas element opens this instead of the InspectorPanel
 * (an epic box carries no real hierarchy node_id), reusing EpicBriefView unchanged. */
class EpicBriefPanelStore extends Store {
  private itemId: string | null = null;

  getItemId = (): string | null => this.itemId;

  open = (itemId: string): void => {
    this.itemId = itemId;
    this.emit();
  };

  close = (): void => {
    this.itemId = null;
    this.emit();
  };

  reset(): void {
    this.close();
  }
}

export const epicBriefPanelStore = new EpicBriefPanelStore();

export function useEpicBriefPanelItemId(): string | null {
  return useSyncExternalStore(epicBriefPanelStore.subscribe, epicBriefPanelStore.getItemId);
}
