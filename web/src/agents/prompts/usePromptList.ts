import type { AgentClient } from "../agentClient";
import type { AgentStatus } from "../../state/types";
import { useAgentPoll } from "../useAgentPoll";
import { promptNavStore } from "./promptNavStore";

/** How often the shown agent's prompt list is re-read while the agent is live. */
export const PROMPTS_POLL_MS = 3000;

/** Loads the agent's prompts into the navigator while `enabled`; polls only while it is working and the page is visible. */
export function usePromptList(client: AgentClient, agentId: string, status: AgentStatus, enabled: boolean): void {
  useAgentPoll(agentId, status, enabled && !!client.prompts, PROMPTS_POLL_MS, async (isLive) => {
    const reply = await client.prompts!(agentId);
    if (isLive()) promptNavStore.setPrompts(agentId, reply.prompts ?? []);
  });
}
