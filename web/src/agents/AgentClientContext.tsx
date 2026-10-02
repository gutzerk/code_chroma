import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SAME_ORIGIN } from "../engine-client/EngineClientContext";
import type { AgentClient } from "./agentClient";
import { HttpAgentClient } from "./agentClient";
import { MockAgentClient } from "./mockAgentClient";

const AgentClientReactContext = createContext<AgentClient | null>(null);

/** VITE_ENGINE_BRIDGE_URL unset ⇒ the fixture mock, exactly as the engine client decides. */
function createAgentClientForUrl(bridgeUrl: string | undefined): AgentClient {
  if (!bridgeUrl) return new MockAgentClient();
  return new HttpAgentClient(bridgeUrl === SAME_ORIGIN ? window.location.origin : bridgeUrl);
}

export function AgentClientProvider({
  client: injectedClient,
  children,
}: {
  /** Test-only override — bypasses the mock/HTTP switch. */
  client?: AgentClient;
  children: ReactNode;
}) {
  const client = useMemo(
    () =>
      injectedClient ??
      createAgentClientForUrl(import.meta.env.VITE_ENGINE_BRIDGE_URL as string | undefined),
    [injectedClient],
  );
  return (
    <AgentClientReactContext.Provider value={client}>{children}</AgentClientReactContext.Provider>
  );
}

export function useAgentClient(): AgentClient {
  const client = useContext(AgentClientReactContext);
  if (!client) {
    throw new Error("useAgentClient must be used within an AgentClientProvider");
  }
  return client;
}
