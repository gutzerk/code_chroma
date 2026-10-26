/** The desktop shell's DesktopWorkspaceApi -- present only when running inside the
 * desktop shell, absent in the browser dev flow. */
export interface DesktopWorkspaceApi {
  openWorkspaceWindow(workspaceId: string): Promise<void>;
  closeWorkspaceWindow(workspaceId: string): Promise<void>;
  /** Brings this tab's shell window to front and makes this tab active -- the desktop half of
   * clicking a native agent-status notification. */
  focusThisTab(): Promise<void>;
  /** Closes this tab's project and shows the open-project launcher. */
  closeThisProject(): Promise<void>;
  /** Shows the native Save As dialog and writes the base64 content there; `saved` is false when
   * the user cancelled. */
  saveFile?(name: string, mime: string, base64: string): Promise<{ saved: boolean }>;
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
