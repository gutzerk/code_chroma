import type { BranchInfo } from "../state/types";
import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import { isAgentOnBranch } from "./branchScope";
import { branchStore } from "./branchStore";
import { workspaceStore } from "./workspaceStore";

/** Runs one bridge command that returns the new BranchInfo; surfaces a failure in the shared modal
 *  and reports success so callers can decide whether to settle/skip. */
async function runBranchCommand(command: () => Promise<BranchInfo>): Promise<boolean> {
  try {
    branchStore.setBranch(await command());
  } catch (err) {
    branchStore.setError(err instanceof Error ? err.message : String(err));
    return false;
  }
  return true;
}

/** Every checkout the canvas asks for goes through here — a manual pick from the switcher's list is
 * the only caller now (opening an agent's window no longer implies a checkout, see AgentRail.tsx),
 * but any future caller still needs the same three things together (store updated, error surfaced,
 * an out-of-scope active workspace handed back to main). */
export async function switchBranch(client: AgentClient, branch: string): Promise<boolean> {
  if (branch === branchStore.getCurrent()) return true;
  if (!(await runBranchCommand(() => client.switchBranch(branch)))) return false;
  settleActiveWorkspace(client);
  return true;
}

/** PyCharm's Update — pulls the current branch's upstream and refreshes the switcher. No session
 *  touches main's tree, so a fast-forward never races an agent; the branch never changes either, so
 *  nothing has to be settled back to main. */
export async function updateCurrentBranch(client: AgentClient): Promise<boolean> {
  return runBranchCommand(() => client.updateBranch());
}

/** A canvas left drawing an agent that just went out of scope would show data with no window to
 * match it, so the active workspace falls back to main. Also called for a `branch-changed` ping: the
 * checkout may have been made in another browser window, and this one has to settle the same way. */
export function settleActiveWorkspace(client: AgentClient): void {
  const active = agentStore.getAgent(agentStore.getActiveWorkspace());
  if (active === undefined || isAgentOnBranch(active, branchStore.getCurrent())) return;
  agentStore.setActiveWorkspace("main");
  client
    .activateWorkspace("main")
    .then((status) => workspaceStore.setStatus(status))
    .catch(() => {
      // Best effort — a failed switch just leaves the canvas on the previous workspace's data.
    });
}
