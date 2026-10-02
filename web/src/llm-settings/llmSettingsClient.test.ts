import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignCallSite,
  assignCallSiteGroup,
  clearCallSite,
  clearCallSiteGroup,
  createProvider,
  deleteProvider,
  listCallSites,
  listProviders,
  testProvider,
  testProviderDraft,
  updateProvider,
} from "./llmSettingsClient";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    clone: () => ({ json: async () => body }) as unknown as Response,
    json: async () => body,
  } as unknown as Response;
}

describe("llmSettingsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ id: "p1", label: "x" }])));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    const result = await listProviders();

    expect(result).toEqual([{ id: "p1", label: "x" }]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/llm/providers", undefined);
  });

  it("creates a provider as a POST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "p1" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await createProvider({
      label: "x", kind: "cli", adapter: "claude", transport: null, base_url: null,
      api_key_path: null, is_local: false,
    } as never);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/providers");
    expect(init.method).toBe("POST");
  });

  it("updates a provider as a PUT", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "p1" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await updateProvider("p1", { label: "y" } as never);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/providers/p1");
    expect(init.method).toBe("PUT");
  });

  it("deletes a provider as a DELETE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(undefined, true, 204)));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await deleteProvider("p1");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/providers/p1");
    expect(init.method).toBe("DELETE");
  });

  it("tests a provider as a POST", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, provider_id: "p1", message: "ok" })),
    );
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    const result = await testProvider("p1");

    expect(result.ok).toBe(true);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/providers/p1/test");
    expect(init.method).toBe("POST");
  });

  it("tests a draft provider as a POST with no id in the path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, provider_id: null, message: "ok" })),
    );
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    const result = await testProviderDraft({
      label: "x", kind: "cli", adapter: "claude", transport: null, base_url: null,
      api_key_path: null, is_local: false,
    } as never);

    expect(result.ok).toBe(true);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/providers/test");
    expect(init.method).toBe("POST");
  });

  it("lists call sites split into simple and groups", async () => {
    const body = {
      simple: [{ id: "ai_summarizer" }],
      groups: [{ id: "diagrams", label: "Diagrams", members: [], assignment: null }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body)));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    const result = await listCallSites();

    expect(result).toEqual(body);
  });

  it("assigns a call site as a PUT with the assignment body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "ai_summarizer" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await assignCallSite("ai_summarizer", { provider_id: "p1", model: "m", mode: "api" });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/call-sites/ai_summarizer");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      provider_id: "p1", model: "m", mode: "api",
    });
  });

  it("clears a call site as a PUT with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "ai_summarizer" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await clearCallSite("ai_summarizer");

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("assigns a call site group as a PUT with the assignment body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "diagrams" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await assignCallSiteGroup("diagrams", { provider_id: "p1", model: "m" });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/call-site-groups/diagrams");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ provider_id: "p1", model: "m" });
  });

  it("clears a call site group as a PUT with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "diagrams" })));
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await clearCallSiteGroup("diagrams");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/llm/call-site-groups/diagrams");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("throws a clear error when there is no bridge", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "");

    await expect(listProviders()).rejects.toThrow(/no bridge/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the bridge error message on a bad response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "label must be non-empty" }, false, 400)),
    );
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");

    await expect(createProvider({ label: "" } as never)).rejects.toThrow(/label must be/i);
  });
});
