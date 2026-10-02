import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import type { ViewContext } from "./viewContext";
import { launchAgent } from "./launchAgent";

/** What "Add agent here" does: same no-picker flow as launchAgent, but targets whatever workspace
 * the canvas is currently showing. For main/another agent that shares its worktree — deliberately
 * no isolation. For a PR review, it instead forks a fresh branch/worktree from the PR's head.
 * `context` is the current-view description, forwarded to the fresh agent (acknowledge-only);
 * `task`, if given, takes priority and is injected as a real actionable first message instead
 * (e.g. `DrawDiagramButton`'s "Draw…"). */
export async function attachAgent(
  client: AgentClient,
  context?: ViewContext | null,
  task?: string,
): Promise<void> {
  await launchAgent(client, agentStore.getActiveWorkspace(), context, task);
}
