import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

export type CodeViewMode = "popup" | "inline";

/** Global popup-vs-inline code display mode. In-memory only, resets on reload — same FR-018
 * precedent as ExpansionStore (state/expansionState.ts) and TerminalPanelStore. */
class CodeViewModeStore extends Store {
  private modeState: CodeViewMode = "inline";

  getMode = (): CodeViewMode => this.modeState;

  toggle = (): void => {
    this.modeState = this.modeState === "popup" ? "inline" : "popup";
    this.emit();
  };

  /** Sets the mode outright — used by tests to pin a starting mode independent of the default. */
  setMode = (mode: CodeViewMode): void => {
    if (this.modeState === mode) return;
    this.modeState = mode;
    this.emit();
  };

  /** Test/dev-only full reset. */
  reset = (): void => {
    this.modeState = "inline";
    this.emit();
  };
}

export const codeViewModeStore = new CodeViewModeStore().markGlobalStore();

export function useCodeViewMode(): CodeViewMode {
  return useSyncExternalStore(codeViewModeStore.subscribe, codeViewModeStore.getMode);
}
