import type { AgentActivity, AgentPendingPermission, AgentStatus } from "../state/types";
import type { PermissionDecision } from "./agentClient";

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
  /** Native clipboard write avoids WebKit permission prompts; reads stay private to the shell script. */
  writeClipboard?(text: string): Promise<void>;
  /** Native Save As for base64 content; `saved` is false when the user cancelled. */
  saveFile?(name: string, mime: string, base64: string): Promise<{ saved: boolean }>;
  /** Posts this project's `agent-summary` to the shell, which draws the project tab's dot, badge and pill. */
  reportAgents?(summary: AgentSummaryMessage): void;
  /** Registers a listener for the shell's agent commands (`select-agent`, `permission`); may return an unsubscribe. */
  onAgentCommand?(listener: (command: AgentCommand) => void): void | (() => void);
}

/** One agent in the `agent-summary` the page sends to the shell. */
export interface AgentSummaryEntry {
  id: string;
  title: string;
  status: AgentStatus;
  worktree: string | null;
  worktree_title: string | null;
  activity: AgentActivity | null;
  pending_permission: AgentPendingPermission | null;
  status_since: string | null;
}

/** Page -> shell: every agent's effective status; the shell computes the tab's dot, badge and pill from it. */
export interface AgentSummaryMessage {
  type: "agent-summary";
  agents: AgentSummaryEntry[];
}

/** Shell -> page, delivered through `window.__ccAgentCommand(<json>)`. */
export type AgentCommand =
  | { type: "select-agent"; id: string }
  | { type: "permission"; id: string; request_id: string; decision: PermissionDecision };

declare global {
  interface Window {
    codechromaDesktop?: DesktopWorkspaceApi;
  }
}

/** Its presence is the desktop-app detection: no user-agent sniffing needed. */
export function getDesktopWorkspaceApi(): DesktopWorkspaceApi | undefined {
  return typeof window === "undefined" ? undefined : window.codechromaDesktop;
}
