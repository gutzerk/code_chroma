import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DefaultCard } from "./DefaultCard";
import * as client from "./llmSettingsClient";
import type { DefaultAssignment, Provider } from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  fetchCliStatus: vi.fn(),
}));

function provider(id: string, label: string, kind: "cli" | "api", caps: { agents: boolean; quick: boolean }): Provider {
  return {
    id, label, kind, adapter: kind === "cli" ? "claude" : null,
    transport: kind === "api" ? "anthropic" : null, base_url: null, api_key_set: true,
    api_key_path: null, is_local: false, test_model: null, verify_ssl: true, capabilities: caps,
  } as Provider;
}

const CLI = provider("cli", "Claude Code", "cli", { agents: true, quick: false });
const API = provider("api", "Anthropic API", "api", { agents: false, quick: true });
const DEF: DefaultAssignment = { provider_id: "cli", model: "sonnet", quick_fallback: null, agent_fallback: null };

function renderCard(selected: Provider, def: DefaultAssignment | null, models: Record<string, string[]> = {}) {
  render(
    <DefaultCard
      providers={[CLI, API]}
      def={def}
      selectedId={selected.id}
      modelsOf={(id) => (id ? models[id] ?? [] : [])}
      load={async () => []}
      headline="h"
      onPickConnection={() => {}}
      onPickModel={() => {}}
      onPickFallback={() => {}}
      onAddConnection={() => {}}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe("DefaultCard", () => {
  it("shows Signed in for a signed-in CLI connection", async () => {
    vi.mocked(client.fetchCliStatus).mockResolvedValue({
      executable: "/bin/claude", version: null, failure_reason: null, signed_in: true,
    });

    renderCard(CLI, DEF);

    await waitFor(() => expect(screen.getByTestId("llm-default-status").textContent).toBe("Signed in"));
  });

  it("shows no status when the CLI can't be probed", async () => {
    vi.mocked(client.fetchCliStatus).mockRejectedValue(new Error("boom"));

    renderCard(CLI, DEF);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId("llm-default-status")).toBeNull();
  });

  it("shows Key set for an api connection without probing it", () => {
    renderCard(API, { ...DEF, provider_id: "api" });

    expect(screen.getByTestId("llm-default-status").textContent).toBe("Key set");
    expect(client.fetchCliStatus).not.toHaveBeenCalled();
  });

  it("labels fallback pills with connection and model", () => {
    vi.mocked(client.fetchCliStatus).mockResolvedValue(null);

    renderCard(CLI, DEF, { api: ["haiku-5.5"] });

    expect(screen.getByText("Anthropic API · haiku-5.5")).toBeTruthy();
  });
});
