import { useEffect, useSyncExternalStore } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { createEngineClient, useEngineClient } from "../engine-client/EngineClientContext";
import { useCanvasDoc } from "../canvas/doc/canvasDocStore";
import { workspaceQuestionDocs } from "../canvas/doc/question/workspaceQuestionDocs";
import type { AgentRecord, CanvasDoc } from "../state/types";
import { agentStore } from "./agentStore";

/** The workspace id an agent's ask_user writes to: the id it shares (followed through other agents), else its own id; null for an unknown agent. */
export function questionWorkspaceOf(agentId: string, agents: readonly AgentRecord[]): string | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  let agent = byId.get(agentId);
  if (!agent) return null;
  const seen = new Set<string>();
  while (agent.shares_workspace_with && !seen.has(agent.id)) {
    seen.add(agent.id);
    const next = byId.get(agent.shares_workspace_with);
    if (!next) return agent.shares_workspace_with;
    agent = next;
  }
  return agent.id;
}

/** Every agent workspace the canvas is not drawing, sorted and joined so an unchanged set compares equal. */
function otherQuestionWorkspaces(): string {
  const agents = agentStore.getAgents();
  const active = agentStore.getActiveWorkspace();
  const ids = new Set(agents.map((agent) => questionWorkspaceOf(agent.id, agents)).filter((id): id is string => id !== null && id !== active));
  return [...ids].sort().join("\n");
}

/** Keeps the canvas doc of every agent workspace other than the active one loaded and live (its `canvas` pings), for the windows and badges. */
export function useAgentQuestionSync(makeClient: (repoId: string) => EngineClient = createEngineClient): void {
  const key = useSyncExternalStore(agentStore.subscribe, otherQuestionWorkspaces);
  useEffect(() => {
    workspaceQuestionDocs.retain(key ? key.split("\n") : [], makeClient);
  }, [key, makeClient]);
  useEffect(() => () => workspaceQuestionDocs.retain([], makeClient), [makeClient]);
}

/** Where one agent's questions live: the active canvas doc and client when it asks there (or is unknown), else its own workspace's. */
export function useAgentQuestionSource(agentId: string): { doc: CanvasDoc; client: EngineClient } {
  const activeDoc = useCanvasDoc();
  const activeClient = useEngineClient();
  const repo = useSyncExternalStore(agentStore.subscribe, () => questionWorkspaceOf(agentId, agentStore.getAgents()));
  const active = useSyncExternalStore(agentStore.subscribe, agentStore.getActiveWorkspace);
  const other = useSyncExternalStore(workspaceQuestionDocs.subscribe, () =>
    repo === null || repo === active ? undefined : workspaceQuestionDocs.getSource(repo),
  );
  if (other?.doc) return { doc: other.doc, client: other.client };
  return { doc: activeDoc, client: activeClient };
}
