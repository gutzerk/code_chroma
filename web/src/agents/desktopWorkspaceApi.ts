/** Mirrors desktop/src/preload.ts's DesktopWorkspaceApi -- present only when running inside the
 * Electron desktop app, absent in the browser dev flow. */
export interface DesktopWorkspaceApi {
  openWorkspaceWindow(workspaceId: string): Promise<void>;
  closeWorkspaceWindow(workspaceId: string): Promise<void>;
  /** Brings this tab's shell window to front and makes this tab active -- the desktop half of
   * clicking a native agent-status notification. */
  focusThisTab(): Promise<void>;
}

declare global {
  interface Window {
    codechromaDesktop?: DesktopWorkspaceApi;
  }
}

/** Its presence is the desktop-app detection: no user-agent sniffing needed. */
export function getDesktopWorkspaceApi(): DesktopWorkspaceApi | undefined {
  return typeof window === "undefined" ? undefined : window.codechromaDesktop;
}
