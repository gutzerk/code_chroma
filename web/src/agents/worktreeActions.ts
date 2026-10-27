import type { WorktreeList } from "../state/types";
import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { messageOf } from "../util/reportError";
import { workspaceStore } from "./workspaceStore";
import { worktreeStore } from "./worktreeStore";

function applyList(list: WorktreeList): void {
  worktreeStore.setList(list.branches, list.active);
}

/** Makes `id` (a worktree tab or an agent/PR workspace id) the canvas's workspace, persisting a tab
 * choice and bringing its graph up; a no-op when it is already shown. */
export function selectWorktree(client: AgentClient, id: string): void {
  const isTab = worktreeStore.has(id);
  if (agentStore.getActiveWorkspace() === id && (!isTab || worktreeStore.getActiveId() === id)) return;
  agentStore.setActiveWorkspace(id);
  if (isTab) {
    worktreeStore.setActive(id);
    void client.setActiveWorktree(id).catch(() => {
      // Best effort: the choice only matters for the next boot.
    });
  }
  client
    .activateWorkspace(id)
    .then((status) => workspaceStore.setStatus(status))
    // A swallowed failure would leave the canvas silently on the previous workspace's data.
    .catch((err) => agentStore.setLaunchError(messageOf(err)));
}

/** Boot: restores every tab (creating `wt-N` only when none exist) and selects the active one. */
export async function ensureWorktrees(client: AgentClient): Promise<void> {
  const list = await client.ensureWorktrees();
  applyList(list);
  const current = agentStore.getActiveWorkspace();
  // A window opened on a PR (?workspace=pr-N) keeps it; an explicit known tab (?workspace=br_x) wins
  // over the bridge's active one (and is PUT as active); anything else follows the tab list.
  if (current.startsWith("pr-")) return;
  const target = worktreeStore.has(current) ? current : worktreeStore.getActiveId();
  if (target) selectWorktree(client, target);
}

/** Re-reads the tab list (dirty counts included) without touching the selection. */
export async function refreshWorktrees(client: AgentClient): Promise<void> {
  const list = await client.listWorktrees();
  worktreeStore.setList(list.branches, worktreeStore.getActiveId() ?? list.active);
}

/** The strip's "+": serialized by the busy flag, selects the new tab, surfaces a fetch fallback warning. */
export async function createWorktree(client: AgentClient): Promise<void> {
  if (worktreeStore.getCreating()) return;
  worktreeStore.beginCreate();
  try {
    const created = await client.createWorktree();
    worktreeStore.addCreated(created.branch, created.warning ?? null);
    selectWorktree(client, created.branch.id);
  } catch (err) {
    worktreeStore.setWarning(messageOf(err));
  } finally {
    worktreeStore.setCreating(false);
  }
}

/** Renames a tab; rejects with the bridge's message (409 on a duplicate) so the strip can show it inline. */
export async function renameWorktree(client: AgentClient, id: string, name: string): Promise<void> {
  await client.renameWorktree(id, name);
  worktreeStore.rename(id, name);
}

/** Drops a removed tab from the strip; when it was the shown one, selects a neighbour, or creates a fresh tab when none is left. */
export async function settleRemovedWorktree(client: AgentClient, id: string): Promise<void> {
  const index = worktreeStore.getRecords().findIndex((record) => record.id === id);
  const wasShown = agentStore.getActiveWorkspace() === id || worktreeStore.getActiveId() === id;
  worktreeStore.remove(id);
  if (!wasShown) return;
  const remaining = worktreeStore.getRecords();
  const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
  if (next) selectWorktree(client, next.id);
  else await ensureWorktrees(client);
}

/** Closes a tab (and its agents); selects a neighbour, or creates a fresh tab when none is left. */
export async function closeWorktree(client: AgentClient, id: string, deleteWorktree: boolean): Promise<void> {
  await client.closeWorktree(id, deleteWorktree);
  agentStore.removeMany(
    agentStore
      .getAgents()
      .filter((agent) => agent.workspace === id || agent.shares_workspace_with === id)
      .map((agent) => agent.id),
  );
  await settleRemovedWorktree(client, id);
}
