import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LlmSettingsPanel } from "./LlmSettingsPanel";

type Needs = "agents" | "quick";

const PROVIDERS = [
  { id: "claude", label: "Claude Code", kind: "cli", adapter: "claude", transport: null, base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null, verify_ssl: true, capabilities: { agents: true, quick: false } },
  { id: "gemini", label: "Gemini API", kind: "api", adapter: null, transport: "gemini", base_url: null, api_key_set: true, api_key_path: null, is_local: false, test_model: null, verify_ssl: true, capabilities: { agents: false, quick: true } },
];
const FEATURES: { id: string; needs: Needs }[] = [
  { id: "diagrams", needs: "agents" },
  { id: "planning", needs: "agents" },
  { id: "agents", needs: "agents" },
  { id: "ai_summarizer", needs: "quick" },
  { id: "initial_diagram_bootstrap", needs: "quick" },
];
const MODELS: Record<string, string[]> = { claude: ["opus", "sonnet"], gemini: ["flash"] };

/** A tiny in-memory bridge for the /llm routes this dialog uses, so the real client + UI run together. */
function fakeBridge() {
  let def: { provider_id: string; model: string; quick_fallback: null; agent_fallback: null } | null = null;
  const overrides: Record<string, { provider_id: string; model: string }> = {};

  const provider = (id: string | undefined) => PROVIDERS.find((p) => p.id === id);
  const row = ({ id, needs }: { id: string; needs: Needs }) => {
    const override = overrides[id];
    const viaDefault = def && provider(def.provider_id)?.capabilities[needs] ? def : null;
    const effective = override ?? viaDefault;
    return {
      id,
      label: id,
      description: `${id} description`,
      needs,
      effective: {
        provider_id: effective?.provider_id ?? null,
        provider_name: provider(effective?.provider_id)?.label ?? null,
        model: effective?.model ?? null,
      },
      source: override ? "custom" : viaDefault ? "default" : "legacy",
      compatible_provider_ids: PROVIDERS.filter((p) => p.capabilities[needs]).map((p) => p.id),
    };
  };

  const respond = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body, clone: () => ({ json: async () => body }) }) as unknown as Response;

  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const featureId = path.match(/^\/llm\/features\/(.+)$/)?.[1];
    if (path === "/llm/providers") {
      const used = FEATURES.map((f) => row(f).effective.provider_id);
      return respond(PROVIDERS.map((p) => ({ ...p, used_by: used.filter((id) => id === p.id).length })));
    }
    if (path === "/llm/default" && method === "PUT") {
      def = { quick_fallback: null, agent_fallback: null, ...body };
      return respond({ default: def });
    }
    if (path === "/llm/default") return respond({ default: def });
    if (path === "/llm/features") return respond({ features: FEATURES.map(row) });
    if (featureId && method === "PUT") overrides[featureId] = body;
    if (featureId && method === "DELETE") delete overrides[featureId];
    if (featureId) return respond(row(FEATURES.find((f) => f.id === featureId)!));
    const models = path.match(/^\/llm\/providers\/(.+)\/models$/)?.[1];
    if (models) return respond({ supported: true, models: MODELS[models].map((id) => ({ id, label: null })) });
    return respond({});
  });
}

describe("LLM settings journey: one model for everything", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://localhost:8000");
    vi.stubGlobal("fetch", fakeBridge());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("picks a default, overrides one feature, then resets it", async () => {
    render(<LlmSettingsPanel onDismiss={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("llm-default-conn-claude"));
    await waitFor(() =>
      expect(screen.getByTestId("llm-feature-source-diagrams").textContent).toBe("Default")
    );
    expect(screen.getByTestId("llm-feature-source-ai_summarizer").textContent).toBe("Not set");
    expect(screen.getByTestId("llm-quick-fallback")).toBeTruthy();

    fireEvent.click(screen.getByTestId("llm-feature-toggle-diagrams"));
    fireEvent.click(await within(screen.getByTestId("llm-feature-diagrams")).findByRole("button", { name: "opus" }));
    await waitFor(() =>
      expect(screen.getByTestId("llm-feature-source-diagrams").textContent).toBe("Custom")
    );

    fireEvent.click(screen.getByTestId("llm-feature-reset-diagrams"));
    await waitFor(() =>
      expect(screen.getByTestId("llm-feature-source-diagrams").textContent).toBe("Default")
    );
    expect(screen.queryByTestId("llm-reset-all")).toBeNull();
  });
});
