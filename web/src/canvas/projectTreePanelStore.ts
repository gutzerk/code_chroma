import { PanelStore, useIsPanelOpen } from "./panelStore";

/** Global project-tree panel open/closed store — the shared PanelStore shape, nothing extra.
 * Open by default: the tree now lives in this sidebar (not on the canvas), so it starts visible
 * like an IDE's explorer. */
export const projectTreePanelStore = new PanelStore(true).markGlobalStore();

export function useIsProjectTreePanelOpen(): boolean {
  return useIsPanelOpen(projectTreePanelStore);
}
