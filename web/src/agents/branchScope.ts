import type { AgentRecord } from "../state/types";

/**
 * The one rule for "does this agent belong to the branch main has checked out right now?" — the
 * window layer, the rail and the notification suppressor all read it from here rather than each
 * comparing branches their own way.
 *
 * An agent keeps running while it is out of scope: its worktree is its own, so a checkout in main
 * cannot touch it. Only its window is hidden, and only in this browser — nothing is persisted, so
 * switching back finds the layout exactly as the user left it.
 */
export function isAgentOnBranch(agent: AgentRecord, current: string | null): boolean {
  // A record with no base branch, and a detached HEAD with nothing to compare it to — hiding on a
  // guess would make a live agent unreachable, so both cases stay in scope.
  const base = baseBranchOf(agent);
  if (base === null || current === null) return true;
  return base === current;
}

/** 🔴 The one place `base_branch` is read: a bridge older than the field omits it altogether, and an
 * `undefined` compared against a branch name is unequal to all of them — which put every agent of
 * every such bridge off-branch and hid its window. Absent and null mean the same thing here. */
export function baseBranchOf(agent: AgentRecord): string | null {
  return agent.base_branch ?? null;
}
