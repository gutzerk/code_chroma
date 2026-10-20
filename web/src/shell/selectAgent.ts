import type { AgentClient } from "../agents/agentClient";
import { restoreAgentWindow } from "../agents/windowActions";
import { shellStore } from "./shellStore";

/** Shows an agent in the panel and makes the canvas follow its workspace, as clicking its old rail card did. */
export function selectAgent(client: AgentClient, id: string): void {
  shellStore.openAgent(id);
  restoreAgentWindow(client, id);
}
