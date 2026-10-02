import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { workspaceStore } from "./workspaceStore";

/** Applies a geometry patch to the store and mirrors it to the bridge, for every caller that moves,
 * raises, minimizes or restores a window — an unpersisted change is one a reload silently undoes. */
export function persist(
  client: AgentClient,
  id: string,
  patch: Parameters<AgentClient["saveWindow"]>[1],
) {
  agentStore.setWindow(id, patch);
  void client.saveWindow(id, patch).catch(() => {
    // A geometry save is cosmetic; a failed one must never interrupt the session.
  });
}

export function minimizeAgentWindow(client: AgentClient, id: string): void {
  persist(client, id, { minimized: true });
}

/** Unminimizes and raises a window without touching the active workspace — for a caller that
 * already knows the canvas is showing the right data (e.g. an agent attached to the current
 * workspace) and must not trigger a workspace-switch reset just to become visible. */
export function openAgentWindow(client: AgentClient, id: string): void {
  persist(client, id, { minimized: false, z: agentStore.bringToFront(id) });
}

/** Restores and raises in one patch, so a window reopened from the rail or panel lands on top.
 * Also makes that agent's workspace the active one: opening an agent's window is exactly the
 * moment the user wants the canvas — and its C1/diff view — to follow it, so this is the one
 * place a window action is deliberately coupled to a workspace switch (unlike minimize, which
 * must never touch the active workspace). A no-op if it's already the active workspace, so
 * bringing an already-open window back to front doesn't spam the bridge. */
export function restoreAgentWindow(client: AgentClient, id: string): void {
  openAgentWindow(client, id);
  if (!shouldActivateWorkspace(id)) return;
  agentStore.setActiveWorkspace(id);
  client
    .activateWorkspace(id)
    .then((status) => workspaceStore.setStatus(status))
    .catch((err) => {
      // A swallowed failure here used to leave the canvas silently stuck on the previous
      // workspace's data with no way to tell why a click "did nothing" — surface it instead.
      agentStore.setLaunchError(err instanceof Error ? err.message : String(err));
    });
}

/** Whether opening an agent's window must make its id the active workspace — no when the agent is
 * already the active workspace, and no when it shares that workspace's data. An "Add agent here"
 * agent renders the exact same canvas, so re-activating its id would trip App.tsx's workspace-scoped
 * store reset and wipe view state (e.g. the focused epic) for no change on screen. Same for a PR it
 * was forked from: reopening the agent is still a child-of-the-PR action, so the canvas must not
 * leave the PR the user is reviewing. */
function shouldActivateWorkspace(agentId: string): boolean {
  const active = agentStore.getActiveWorkspace();
  if (active === agentId) return false;
  const agent = agentStore.getAgent(agentId);
  if ((agent?.shares_workspace_with ?? null) === active) return false;
  if (agent?.source_pr === active) return false;
  return true;
}

/** Whether closing `id` may delete a worktree — true only when it is the *last* agent on its own
 * worktree. An agent that shares a worktree (attached to main or to another agent, or a PR's
 * attached agent) must never delete it, since the directory outlives the close; the same goes for
 * one whose worktree is already gone. Anything else closes immediately with no dialog, because
 * there is nothing unique left in the directory to protect. */
// Mirrors `AgentManager._guard_shared_worktree` — drift here can under-offer a delete, never over-offer.
function closeMayDeleteWorktree(id: string): boolean {
  const agent = agentStore.getAgent(id);
  if (!agent || agent.worktree_lost) return false;
  if ((agent.shares_workspace_with ?? null) !== null) return false;
  return !agentStore
    .getAgents()
    .some((other) => other.id !== id && other.worktree === agent.worktree);
}

/** Closes the agent: the session dies and the card goes. The worktree directory is kept unless it
 * would be left orphaned *and* the user ticks the confirm dialog's checkbox; the `agent/<id>` branch
 * is never deleted from the UI — a closed agent is meant to be picked back up by attaching a new one
 * to that surviving branch. "×" is the only destructive-sounding button there is, and by default it
 * destroys nothing but the session. */
export function closeAgentWindow(client: AgentClient, id: string): void {
  if (closeMayDeleteWorktree(id)) {
    agentStore.setPendingClose(id);
    return;
  }
  client
    .remove(id)
    .then(() => agentStore.remove(id))
    .catch(() => {
      // Best effort — a failed close just leaves the window where it was.
    });
}

/** The CloseAgentDialog's confirm path: runs the real delete, optionally taking the worktree with it,
 * clears the dialog on success, and rejects with the bridge's refusal on failure. The dialog owns its
 * busy/error state around this promise. */
export function confirmCloseAgentWindow(
  client: AgentClient,
  id: string,
  deleteWorktree: boolean,
): Promise<void> {
  return client.remove(id, deleteWorktree ? { worktree: true } : {}).then(() => {
    agentStore.remove(id);
    agentStore.setPendingClose(null);
  });
}
