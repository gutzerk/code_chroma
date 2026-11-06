import type { WorktreeList } from "../state/types";
import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { messageOf } from "../util/reportError";
import { workspaceStore } from "./workspaceStore";
import { worktreeStore } from "./worktreeStore";
import { getDesktopWorkspaceApi } from "./desktopWorkspaceApi";
import { prStore } from "../pr/prStore";

function applyList(list: WorktreeList): void {
  worktreeStore.setList(list.branches, list.active);
}

/** Activates `id` on the bridge and shows its status; rejects with the bridge's error for the caller's own policy. */
async function activate(client: AgentClient, id: string): Promise<void> {
  workspaceStore.setStatus(await client.activateWorkspace(id));
}

/** Makes `id` (a worktree tab or an agent/PR workspace id) the canvas's workspace, persisting a tab
 * choice and bringing its graph up; a no-op when it is already shown. */
export function selectWorktree(client: AgentClient, id: string): Promise<void> {
  const isTab = worktreeStore.has(id);
  if (agentStore.getActiveWorkspace() === id && (!isTab || worktreeStore.getActiveId() === id)) return Promise.resolve();
  agentStore.setActiveWorkspace(id);
  if (isTab) {
    worktreeStore.setActive(id);
    void client.setActiveWorktree(id).catch(() => {
      // Best effort: the choice only matters for the next boot.
    });
  }
  return activate(client, id)
    // A swallowed failure would leave the canvas silently on the previous workspace's data.
    .catch((err) => agentStore.setLaunchError(messageOf(err)));
}

/** Boot: restores every tab (creating `wt-N` only when none exist), selects the active one and
 * reopens the PR review the project was last showing. */
export async function ensureWorktrees(client: AgentClient): Promise<void> {
  const [list, rememberedPr] = await Promise.all([client.ensureWorktrees(), lastViewedPr(client)]);
  applyList(list);
  const current = agentStore.getActiveWorkspace();
  // A window opened on a PR (?workspace=pr-N) keeps it and records it as the last-viewed workspace.
  if (current.startsWith("pr-")) {
    activate(client, current).catch(() => {
      // Best effort: the status banner's own poll reports a PR that can no longer be drawn.
    });
    return;
  }
  // An explicit known tab (?workspace=br_x) wins over the bridge's active one (and is PUT as active);
  // anything else follows the tab list.
  const target = worktreeStore.has(current) ? current : worktreeStore.getActiveId();
  const desktop = getDesktopWorkspaceApi();
  if (rememberedPr && !desktop) {
    await restorePr(client, rememberedPr, target);
    return;
  }
  if (target) await selectWorktree(client, target);
  // The desktop app shows a PR review in its own tab, so it reopens that tab beside this one.
  if (rememberedPr && desktop) {
    await desktop.openWorkspaceWindow(rememberedPr).catch(() => {
      // Best effort: the review stays one click away in the PR dialog.
    });
  }
}

/** The PR review the bridge last drew for this project, when it is still open; null otherwise. */
async function lastViewedPr(client: AgentClient): Promise<string | null> {
  try {
    const { prs, active_workspace: active } = await client.listPrs();
    prStore.setList(prs);
    return prs.some((pr) => pr.id === active) ? active : null;
  } catch {
    return null;
  }
}

/** Draws the remembered PR in place; one that can no longer be loaded falls back to the tab silently. */
async function restorePr(client: AgentClient, id: string, fallback: string | null): Promise<void> {
  agentStore.setActiveWorkspace(id);
  try {
    await activate(client, id);
  } catch {
    if (fallback) await selectWorktree(client, fallback);
    else agentStore.setActiveWorkspace("main");
  }
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
