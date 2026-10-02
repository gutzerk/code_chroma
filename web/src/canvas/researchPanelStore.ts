import { PanelStore, useIsPanelOpen } from "./panelStore";

/** Global research-panel open/closed store — the shared PanelStore shape, nothing extra. */
export const researchPanelStore = new PanelStore().markGlobalStore();

export function useIsResearchPanelOpen(): boolean {
  return useIsPanelOpen(researchPanelStore);
}
