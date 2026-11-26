import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

export type SettingsCategory = "llm" | "updates" | "canvas-style" | "integrations";

/** Whether Settings is open and which category dialog it shows, so other chrome can deep-link into a category. */
class SettingsStore extends Store {
  private state: { open: boolean; category: SettingsCategory | null } = { open: false, category: null };

  getState = () => this.state;

  /** Opens Settings, on its home list or straight on one category. */
  open = (category: SettingsCategory | null = null): void => {
    this.state = { open: true, category };
    this.emit();
  };

  /** Back from a category dialog to the Settings home. */
  showHome = (): void => this.open(null);

  close = (): void => {
    this.state = { open: false, category: null };
    this.emit();
  };

  toggle = (): void => (this.state.open ? this.close() : this.open());

  reset = (): void => this.close();
}

export const settingsStore = new SettingsStore().markGlobalStore();

export function useSettingsState(): { open: boolean; category: SettingsCategory | null } {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getState);
}
