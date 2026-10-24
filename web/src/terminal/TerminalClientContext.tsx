import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SAME_ORIGIN } from "../engine-client/EngineClientContext";
import type { TerminalClient } from "./TerminalClient";
import { WebSocketTerminalClient } from "./TerminalClient";
import { PreviewTerminalClient } from "./previewTerminalClient";

const TerminalClientReactContext = createContext<TerminalClient | null>(null);

/** The desktop build serves this bundle from the bridge itself, so its port is already in our URL. */
export function terminalBaseUrl(bridgeUrl: string): string {
  return bridgeUrl === SAME_ORIGIN
    ? window.location.origin.replace(/^http/, "ws")
    : bridgeUrl;
}

/** Dev builds with no bridge configured (the mock canvas) get the scripted preview terminal instead of a socket that can never connect. */
function isPreviewTerminal(): boolean {
  if (!import.meta.env.DEV) return false;
  const mocked = !import.meta.env.VITE_ENGINE_BRIDGE_URL && !import.meta.env.VITE_TERMINAL_BRIDGE_URL;
  return mocked || new URLSearchParams(window.location.search).has("mockTerminal");
}

/** VITE_TERMINAL_BRIDGE_URL unset ⇒ default to the local dev terminal server. */
function createTerminalClient(): TerminalClient {
  if (isPreviewTerminal()) return new PreviewTerminalClient();
  const bridgeUrl =
    (import.meta.env.VITE_TERMINAL_BRIDGE_URL as string | undefined) ?? "ws://localhost:8000";
  return new WebSocketTerminalClient(terminalBaseUrl(bridgeUrl));
}

export function TerminalClientProvider({
  client: injectedClient,
  children,
}: {
  /** Test-only override — bypasses createTerminalClient's WebSocket setup. */
  client?: TerminalClient;
  children: ReactNode;
}) {
  const client = useMemo(() => injectedClient ?? createTerminalClient(), [injectedClient]);
  return (
    <TerminalClientReactContext.Provider value={client}>
      {children}
    </TerminalClientReactContext.Provider>
  );
}

export function useTerminalClient(): TerminalClient {
  const client = useContext(TerminalClientReactContext);
  if (!client) {
    throw new Error("useTerminalClient must be used within a TerminalClientProvider");
  }
  return client;
}
