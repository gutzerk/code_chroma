import type { EngineClient } from "../engine-client/EngineClient";
import { createEngineClientForUrl } from "../engine-client/EngineClientContext";
import { agentStore } from "./agentStore";

/**
 * Badges an agent's rail row once its OWN workspace holds a drawn diagram.
 *
 * 🔴 A "Draw a diagram" task launched from a read-only PR workspace is forked into a brand-new
 * worktree (`AgentManager.create`), so the skill writes its artifact where the canvas is not
 * looking. Without this the agent finishes, reports success, and nothing ever appears.
 *
 * Skipped when the agent shares the workspace the canvas is already drawing: there
 * `DrawDiagramButton`'s watcher subscription adds the diagram by itself, and a badge would be pure
 * noise.
 */
export async function flagDiagramsReady(
  agentId: string,
  makeClient: (repoId: string) => EngineClient = defaultMakeClient,
): Promise<void> {
  if (agentStore.getActiveWorkspace() === agentId) return;
  try {
    const status = await makeClient(agentId).getDiagramsStatus();
    if (Object.values(status).some((entry) => entry?.ready)) {
      agentStore.markDiagramsReady(agentId);
    }
  } catch {
    // A workspace that cannot answer simply gets no badge; nothing here is worth surfacing.
  }
}

/** An agent id IS a workspace/repo id, so the same factory the app boots with points at its fork. */
function defaultMakeClient(repoId: string): EngineClient {
  return createEngineClientForUrl(
    import.meta.env.VITE_ENGINE_BRIDGE_URL as string | undefined,
    repoId,
  );
}
