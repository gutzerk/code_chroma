import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LlmSettingsPanel } from "./LlmSettingsPanel";
import * as client from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  listProviders: vi.fn(),
  listFeatures: vi.fn(),
  getDefault: vi.fn(),
  putDefault: vi.fn(),
  getCallSiteGroup: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  testProviderDraft: vi.fn(),
  assignCallSite: vi.fn(),
  clearCallSite: vi.fn(),
  assignCallSiteGroup: vi.fn(),
  clearCallSiteGroup: vi.fn(),
  fetchProviderModels: vi.fn(),
  putFeature: vi.fn(),
  deleteFeature: vi.fn(),
  fetchCliStatus: vi.fn(async () => null),
  fetchDraftCapabilities: vi.fn(async () => ({ capabilities: { agents: true, quick: false } })),
}));

function renderPanel() {
  const onDismiss = vi.fn();
  vi.mocked(client.listProviders).mockResolvedValue([]);
  vi.mocked(client.listFeatures).mockResolvedValue({ features: [] });
  vi.mocked(client.getDefault).mockResolvedValue({ default: null });
  vi.mocked(client.getCallSiteGroup).mockResolvedValue({
    id: "agents",
    label: "Agent windows",
    members: [],
    assignment: null,
    cli_available: true,
  });
  vi.mocked(client.fetchProviderModels).mockResolvedValue({
    supported: false,
    models: [],
    error: null,
  });
  render(<LlmSettingsPanel onDismiss={onDismiss} />);
  return { onDismiss };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("LlmSettingsPanel", () => {
  it("opens on the models tab", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("llm-models-tab")).toBeTruthy());
  });

  it("switches to the connections tab", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("llm-settings-tab-connections")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-settings-tab-connections"));

    await waitFor(() => expect(screen.getByTestId("llm-providers-section")).toBeTruthy());
    expect(screen.queryByTestId("llm-models-tab")).toBeNull();
  });

  it("opens the add form on the connections tab from the default card", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("+ Add a connection")).toBeTruthy());

    fireEvent.click(screen.getByText("+ Add a connection"));

    await waitFor(() => expect(screen.getByTestId("llm-type-picker")).toBeTruthy());
  });

  it("switches to the advanced tab, which no longer repeats the agent-window picker", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("llm-settings-tab-advanced")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-settings-tab-advanced"));

    await waitFor(() => expect(screen.getByTestId("llm-advanced-tab")).toBeTruthy());
    expect(screen.queryByTestId("assistant-provider")).toBeNull();
  });

  it.each(["llm-settings-dismiss", "llm-settings-done"])("dismisses via %s", async (testId) => {
    const { onDismiss } = renderPanel();
    await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy());

    fireEvent.click(screen.getByTestId(testId));

    expect(onDismiss).toHaveBeenCalled();
  });
});
