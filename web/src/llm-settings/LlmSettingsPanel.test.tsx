import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LlmSettingsPanel } from "./LlmSettingsPanel";
import * as client from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  listProviders: vi.fn(),
  listCallSites: vi.fn(),
  getCallSiteGroup: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  assignCallSite: vi.fn(),
  clearCallSite: vi.fn(),
  assignCallSiteGroup: vi.fn(),
  clearCallSiteGroup: vi.fn(),
  fetchProviderModels: vi.fn(),
}));

const listProviders = vi.mocked(client.listProviders);
const listCallSites = vi.mocked(client.listCallSites);

function renderPanel() {
  const onDismiss = vi.fn();
  listProviders.mockResolvedValue([]);
  listCallSites.mockResolvedValue({ simple: [], groups: [] });
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
  it("opens on the providers tab", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("llm-providers-section")).toBeTruthy());
  });

  it("switches to the model-routing tab", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("llm-settings-tab-call-sites")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-settings-tab-call-sites"));

    await waitFor(() => expect(screen.getByTestId("llm-call-sites-section")).toBeTruthy());
    expect(screen.queryByTestId("llm-providers-section")).toBeNull();
  });

  it("switches to the agent-windows tab, which holds the agent-provider picker", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("llm-settings-tab-assistant")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-settings-tab-assistant"));

    await waitFor(() => expect(screen.getByTestId("assistant-provider")).toBeTruthy());
  });

  it("dismisses", async () => {
    const { onDismiss } = renderPanel();
    await waitFor(() => expect(screen.getByTestId("llm-settings-dismiss")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-settings-dismiss"));

    expect(onDismiss).toHaveBeenCalled();
  });
});
