import type { AgentRecord } from "../state/types";
import type { AgentClient, DiagramTaskHint } from "./agentClient";
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
  diagram?: DiagramTaskHint,
): Promise<void> {
  await runLaunch(client, async () => {
    const preflight = await client.gitPreflight();
    if (preflight.state !== "ready") {
      agentStore.setGitPreflight(preflight);
      return null;
    }
    return task
      ? client.create("", "agent", attachTo, task, "task", diagram)
      : client.create("", "agent", attachTo, context?.description ?? null);
  });
}

/** "Open agent" on a finished workflow step: a claude agent in the run's worktree forking that step's session, opened in the Agents tab. */
export async function openStepAgent(
  client: AgentClient,
  title: string,
  runId: string,
  sessionId: string,
): Promise<void> {
  await runLaunch(client, () => client.openStepSession(title, runId, sessionId));
}

/** The shared launch bookkeeping: capacity guard, create (null: stop quietly), start, open its window; a failure after create opens it with the error. */
async function runLaunch(client: AgentClient, create: () => Promise<AgentRecord | null>): Promise<void> {
  if (agentStore.getIsAtCapacity() || agentStore.getIsLaunching()) return;
  agentStore.setLaunchError(null);
  agentStore.setIsLaunching(true);
  let createdId: string | null = null;
  try {
    const created = await create();
    if (!created) return;
    createdId = created.id;
    agentStore.setStartError(created.id, null);
    agentStore.upsert(created);
    agentStore.upsert(await client.start(created.id));
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
