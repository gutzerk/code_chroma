import { describe, expect, it } from "vitest";
import { createEngineClientForUrl, SAME_ORIGIN } from "./EngineClientContext";
import { terminalBaseUrl } from "../terminal/TerminalClientContext";

describe("createEngineClientForUrl", () => {
  it("falls back to the fixture mock when VITE_ENGINE_BRIDGE_URL is unset", () => {
    const client = createEngineClientForUrl(undefined, "default");

    expect(client.constructor.name).toBe("MockBridgeEngineClient");
  });

  it("uses an explicit bridge URL verbatim, as the vite dev server workflow needs", () => {
    const client = createEngineClientForUrl("http://localhost:8000", "default") as unknown as {
      baseUrl: string;
    };

    expect(client.constructor.name).toBe("HttpEngineClient");
    expect(client.baseUrl).toBe("http://localhost:8000");
  });

  it("resolves the same-origin sentinel to the port the desktop app served us from", () => {
    const client = createEngineClientForUrl(SAME_ORIGIN, "default") as unknown as {
      baseUrl: string;
    };

    expect(client.baseUrl).toBe(window.location.origin);
  });
});

describe("terminalBaseUrl", () => {
  it("turns the same-origin sentinel into a ws:// URL on our own port", () => {
    const url = terminalBaseUrl(SAME_ORIGIN);

    expect(url).toBe(window.location.origin.replace(/^http/, "ws"));
    expect(url.startsWith("ws://")).toBe(true);
  });

  it("leaves an explicit terminal URL untouched", () => {
    expect(terminalBaseUrl("ws://localhost:9000")).toBe("ws://localhost:9000");
  });
});
