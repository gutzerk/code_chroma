import type { AgentClient } from "./agentClient";
import { agentStore } from "./agentStore";
import type { ViewContext } from "./viewContext";
import { openAgentWindow } from "./windowActions";

/** What the "Run agent" button does: no picker, no title prompt — just create, start and open a
 * fresh agent, right away. `create("")` leans on the id-as-title fallback both clients already
 * apply, so there's nothing left to ask the user for. Pass `attachTo` to target an existing
 * workspace rather than a fresh isolated worktree — see attachAgent for what that means. `context`
 * is the short "current view" description the fresh agent acknowledges (acknowledge-only; see
 * parallel-agents.md). `task`, if given, takes priority over `context` and is injected as a real,
 * actionable first message instead (e.g. the "Draw…" launch — see DrawDiagramButton.tsx). */
export async function launchAgent(
  client: AgentClient,
  attachTo?: string,
  context?: ViewContext | null,
  task?: string,
): Promise<void> {
  if (agentStore.getIsAtCapacity() || agentStore.getIsLaunching()) return;
  agentStore.setLaunchError(null);
  agentStore.setIsLaunching(true);
  let createdId: string | null = null;
  try {
    const preflight = await client.gitPreflight();
    if (preflight.state !== "ready") {
      agentStore.setGitPreflight(preflight);
      return;
    }
    const created = task
      ? await client.create("", "agent", attachTo, task, "task")
      : await client.create("", "agent", attachTo, context?.description ?? null);
    createdId = created.id;
    agentStore.setStartError(created.id, null);
    agentStore.upsert(created);
    const started = await client.start(created.id);
    agentStore.upsert(started);
    // Every remaining caller supplies an explicit attachTo, so the new agent shares a workspace
    // the canvas already shows the right data for — just open its window, no workspace switch.
    openAgentWindow(client, created.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (createdId) {
      agentStore.setStartError(createdId, message);
      openAgentWindow(client, createdId);
    } else {
      agentStore.setLaunchError(message);
    }
  } finally {
    agentStore.setIsLaunching(false);
  }
}
