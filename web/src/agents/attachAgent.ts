import type { AgentClient, DiagramTaskHint } from "./agentClient";
import { agentStore } from "./agentStore";
import type { ViewContext } from "./viewContext";
import { launchAgent } from "./launchAgent";
import { worktreeStore } from "./worktreeStore";

/** What "Add agent here" does: same no-picker flow as launchAgent, but targets whatever workspace
 * the canvas is currently showing. For a worktree tab the agent joins that tab's worktree (`workspace`), no attach_to. For a PR review, it instead forks a fresh branch/worktree from the PR's head.
 * `context` is the current-view description, forwarded to the fresh agent (acknowledge-only);
 * `task`, if given, takes priority and is injected as a real actionable first message instead
 * (e.g. `DrawDiagramButton`'s "Draw…"). */
export async function attachAgent(
  client: AgentClient,
  context?: ViewContext | null,
  task?: string,
  diagram?: DiagramTaskHint,
): Promise<void> {
  const active = agentStore.getActiveWorkspace();
  // A worktree tab (or the pre-boot "main" placeholder) is passed as `workspace`, never as attach_to.
  const attachTo = active === "main" || worktreeStore.has(active) ? undefined : active;
  await launchAgent(client, attachTo, context, task, diagram);
}
