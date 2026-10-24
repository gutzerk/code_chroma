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

/** Opt-in scripted preview terminal (dev builds only, `?mockTerminal=1`); the default stays the real socket so `npm run dev` + the terminal server keeps working. */
function isPreviewTerminal(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has("mockTerminal");
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
