import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

export interface DescriptionPopupEntry {
  title: string;
  description: string;
}

/** Which block's full-description popup is open, if any — the "?" button on a CanvasNodeBox opens
 * this instead of the InspectorPanel, since a truncated (line-clamped) description needs a quick way
 * to read the full text without derailing the existing click-opens-Inspector behavior. */
class DescriptionPopupStore extends Store {
  private entry: DescriptionPopupEntry | null = null;

  getEntry = (): DescriptionPopupEntry | null => this.entry;

  open = (title: string, description: string): void => {
    this.entry = { title, description };
    this.emit();
  };

  close = (): void => {
    this.entry = null;
    this.emit();
  };

  reset(): void {
    this.close();
  }
}

export const descriptionPopupStore = new DescriptionPopupStore();

export function useDescriptionPopupEntry(): DescriptionPopupEntry | null {
  return useSyncExternalStore(descriptionPopupStore.subscribe, descriptionPopupStore.getEntry);
}
