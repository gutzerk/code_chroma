import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModelsTab } from "./ModelsTab";
import * as client from "./llmSettingsClient";
import type { DefaultAssignment, Feature, Provider } from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  listProviders: vi.fn(),
  listFeatures: vi.fn(),
  getDefault: vi.fn(),
  putDefault: vi.fn(),
  putFeature: vi.fn(),
  deleteFeature: vi.fn(),
  fetchProviderModels: vi.fn(),
  fetchCliStatus: vi.fn().mockRejectedValue(new Error("no probe")),
}));

function provider(id: string, label: string, caps: { agents: boolean; quick: boolean }): Provider {
  return {
    id,
    label,
    kind: caps.agents ? "cli" : "api",
    adapter: caps.agents ? "claude" : null,
    transport: caps.agents ? null : "gemini",
    base_url: null,
    api_key_set: !caps.agents,
    api_key_path: null,
    is_local: false,
    test_model: null,
    verify_ssl: true,
    capabilities: caps,
    used_by: 0,
  };
}

function feature(id: string, needs: "agents" | "quick", over: Partial<Feature> = {}): Feature {
  return {
    id,
    label: id,
    description: `${id} description`,
    needs,
    effective: { provider_id: "claude", provider_name: "Claude Code", model: "sonnet" },
    source: "default",
    compatible_provider_ids: needs === "agents" ? ["claude"] : ["claude", "gemini"],
    ...over,
  };
}

const CLAUDE = provider("claude", "Claude Code", { agents: true, quick: false });
const GEMINI = provider("gemini", "Gemini API", { agents: false, quick: true });
const DEFAULT: DefaultAssignment = {
  provider_id: "claude",
  model: "sonnet",
  quick_fallback: null,
  agent_fallback: null,
};

function setup(opts: { def?: DefaultAssignment | null; features?: Feature[] } = {}) {
  const features = opts.features ?? [feature("diagrams", "agents"), feature("ai_summarizer", "quick")];
  vi.mocked(client.listProviders).mockResolvedValue([CLAUDE, GEMINI]);
  vi.mocked(client.getDefault).mockResolvedValue({ default: opts.def === undefined ? DEFAULT : opts.def });
  vi.mocked(client.listFeatures).mockResolvedValue({ features });
  vi.mocked(client.putDefault).mockResolvedValue({ default: DEFAULT });
  vi.mocked(client.putFeature).mockResolvedValue({} as never);
  vi.mocked(client.deleteFeature).mockResolvedValue({} as never);
  vi.mocked(client.fetchProviderModels).mockImplementation(async (id) => ({
    supported: true,
    models: id === "claude" ? [{ id: "opus", label: null }, { id: "sonnet", label: null }] : [{ id: "flash", label: null }],
  }));
  render(<ModelsTab onAddConnection={vi.fn()} />);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ModelsTab", () => {
  it("picking a default connection saves it with a blank model for the bridge to pick", async () => {
    setup({ def: null });
    await waitFor(() => expect(screen.getByTestId("llm-default-conn-gemini")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-default-conn-gemini"));

    await waitFor(() =>
      expect(client.putDefault).toHaveBeenCalledWith({
        provider_id: "gemini",
        model: "",
        quick_fallback: null,
        agent_fallback: null,
      })
    );
  });

  it("shows every feature on the default and the all-features headline", async () => {
    setup();

    await waitFor(() =>
      expect(screen.getByTestId("llm-default-headline").textContent).toBe(
        "All 2 features use Claude Code · sonnet."
      )
    );
    expect(screen.getByTestId("llm-feature-source-diagrams").textContent).toBe("Default");
  });

  it("asks for a quick-task fallback when the default is CLI-only", async () => {
    setup();

    await waitFor(() => expect(screen.getByTestId("llm-quick-fallback")).toBeTruthy());
    expect(screen.queryByTestId("llm-agent-fallback")).toBeNull();
  });

  it("saves the chosen quick fallback as an offline fallback", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("llm-quick-fallback")).toBeTruthy());

    fireEvent.click(screen.getByText("Offline · no AI"));

    await waitFor(() =>
      expect(client.putDefault).toHaveBeenCalledWith(
        expect.objectContaining({ quick_fallback: { offline: true } })
      )
    );
  });

  it("overrides a group feature, then resets it back to the default", async () => {
    setup({ features: [feature("diagrams", "agents", { source: "custom" })] });
    await waitFor(() => expect(screen.getByTestId("llm-feature-toggle-diagrams")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-feature-toggle-diagrams"));

    fireEvent.click(await within(screen.getByTestId("llm-feature-diagrams")).findByRole("button", { name: "opus" }));
    await waitFor(() =>
      expect(client.putFeature).toHaveBeenCalledWith("diagrams", {
        provider_id: "claude",
        model: "opus",
      })
    );
    fireEvent.click(screen.getByTestId("llm-feature-reset-diagrams"));

    await waitFor(() => expect(client.deleteFeature).toHaveBeenCalledWith("diagrams"));
  });

  it("overrides a quick-task feature through the same feature route", async () => {
    setup({ features: [feature("ai_summarizer", "quick")] });
    await waitFor(() => expect(screen.getByTestId("llm-feature-toggle-ai_summarizer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-feature-toggle-ai_summarizer"));

    fireEvent.click(await within(screen.getByTestId("llm-feature-ai_summarizer")).findByRole("button", { name: "Gemini API" }));

    await waitFor(() =>
      expect(client.putFeature).toHaveBeenCalledWith("ai_summarizer", {
        provider_id: "gemini",
        model: "",
      })
    );
  });

  it("overrides a quick-task feature to offline", async () => {
    setup({ features: [feature("ai_summarizer", "quick")] });
    await waitFor(() => expect(screen.getByTestId("llm-feature-toggle-ai_summarizer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-feature-toggle-ai_summarizer"));

    fireEvent.click(await within(screen.getByTestId("llm-feature-ai_summarizer")).findByRole("button", { name: "Offline · no AI" }));

    await waitFor(() =>
      expect(client.putFeature).toHaveBeenCalledWith("ai_summarizer", { offline: true })
    );
  });

  it("offers no offline choice for an agent feature", async () => {
    setup({ features: [feature("diagrams", "agents")] });
    await waitFor(() => expect(screen.getByTestId("llm-feature-toggle-diagrams")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-feature-toggle-diagrams"));

    expect(within(screen.getByTestId("llm-feature-diagrams")).queryByRole("button", { name: "Offline · no AI" })).toBeNull();
  });

  it("offers Reset all only while an override exists", async () => {
    setup({ features: [feature("diagrams", "agents", { source: "custom" })] });

    await waitFor(() => expect(screen.getByTestId("llm-reset-all")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-reset-all"));

    await waitFor(() => expect(client.deleteFeature).toHaveBeenCalledWith("diagrams"));
  });
});
