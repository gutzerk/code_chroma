import type { AgentClient } from "../agentClient";
import { useAgentPoll } from "../useAgentPoll";
import { promptNavStore } from "./promptNavStore";

/** How often the shown agent's prompt list is re-read while it runs. */
export const PROMPTS_POLL_MS = 3000;

/** Loads the agent's prompts into the navigator while `enabled`; polls only while it runs and the page is visible. */
export function usePromptList(client: AgentClient, agentId: string, status: string, enabled: boolean): void {
  useAgentPoll(agentId, status, enabled && !!client.prompts, PROMPTS_POLL_MS, async (isLive) => {
    const reply = await client.prompts!(agentId);
    if (isLive()) promptNavStore.setPrompts(agentId, reply.prompts ?? []);
  });
}
