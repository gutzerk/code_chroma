import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { EngineClient } from "./EngineClient";
import { HttpEngineClient } from "./EngineClient";
import { MockBridgeEngineClient } from "./mockBridge";
import { withTutorialDiagramGate } from "../tutorial/tutorialDiagramGate";

const EngineClientReactContext = createContext<EngineClient | null>(null);

/** The desktop build's sentinel: the bridge also serves this bundle, so it owns our own origin. */
export const SAME_ORIGIN = "same-origin";

/** VITE_ENGINE_BRIDGE_URL unset ⇒ use the fixture-backed mock bridge (quickstart.md Prerequisites). */
export function createEngineClientForUrl(
  bridgeUrl: string | undefined,
  repoId: string,
): EngineClient {
  if (!bridgeUrl) {
    return new MockBridgeEngineClient();
  }
  const baseUrl = bridgeUrl === SAME_ORIGIN ? window.location.origin : bridgeUrl;
  return new HttpEngineClient(baseUrl, repoId);
}

function createEngineClient(repoId: string): EngineClient {
  const bridgeUrl = import.meta.env.VITE_ENGINE_BRIDGE_URL as string | undefined;
  return createEngineClientForUrl(bridgeUrl, repoId);
}

export function EngineClientProvider({
  repoId,
  client: injectedClient,
  children,
}: {
  repoId: string;
  /** Test-only override — bypasses createEngineClient's mock/HTTP switch. */
  client?: EngineClient;
  children: ReactNode;
}) {
  const client = useMemo(
    () => injectedClient ?? withTutorialDiagramGate(createEngineClient(repoId)),
    [injectedClient, repoId],
  );
  // A workspace switch builds a fresh client; the old one's socket must not be left open forever.
  useEffect(() => () => client.dispose?.(), [client]);
  return (
    <EngineClientReactContext.Provider value={client}>
      {children}
    </EngineClientReactContext.Provider>
  );
}

export function useEngineClient(): EngineClient {
  const client = useContext(EngineClientReactContext);
  if (!client) {
    throw new Error("useEngineClient must be used within an EngineClientProvider");
  }
  return client;
}
