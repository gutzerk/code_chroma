import { useLayoutState } from "../canvas/layout/layoutStore";
import type { AgentRecord } from "../state/types";
import { useAgents } from "./agentStore";

/** The agent the full-screen view shows: the live selection, else the first agent. */
export function resolveFullScreenAgentId(
  agents: readonly AgentRecord[],
  selectedAgentId: string | null,
): string | null {
  return (agents.find((agent) => agent.id === selectedAgentId) ?? agents[0])?.id ?? null;
}

/** The full-screen agent's id, or null when the agents panel is not in full mode. */
export function useFullScreenAgentId(): string | null {
  const { agentsMode, selectedAgentId } = useLayoutState();
  const agents = useAgents();
  return agentsMode === "full" ? resolveFullScreenAgentId(agents, selectedAgentId) : null;
}
