import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import * as llmClient from "../llm-settings/llmSettingsClient";

vi.mock("../llm-settings/llmSettingsClient", () => ({
  listProviders: vi.fn(),
  listCallSites: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  assignCallSite: vi.fn(),
  clearCallSite: vi.fn(),
  assignCallSiteGroup: vi.fn(),
  clearCallSiteGroup: vi.fn(),
  getCallSiteGroup: vi.fn(),
  fetchProviderModels: vi.fn(),
}));

const listProviders = vi.mocked(llmClient.listProviders);
const listCallSites = vi.mocked(llmClient.listCallSites);

function renderDialog() {
  const onDismiss = vi.fn();
  listProviders.mockResolvedValue([]);
  listCallSites.mockResolvedValue({ simple: [], groups: [] });
  vi.mocked(llmClient.getCallSiteGroup).mockResolvedValue({
    id: "agents",
    label: "Agent windows",
    members: [],
    assignment: null,
    cli_available: true,
  });
  vi.mocked(llmClient.fetchProviderModels).mockResolvedValue({
    supported: false,
    models: [],
    error: null,
  });
  render(<SettingsDialog onDismiss={onDismiss} />);
  return { onDismiss };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsDialog", () => {
  it("offers the LLM category", async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByTestId("settings-open-llm")).toBeTruthy());
  });

  it("summarises how many providers and routed features exist", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Claude CLI", kind: "cli", adapter: "claude", transport: null,
        base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
        verify_ssl: true,
      },
    ]);
    listCallSites.mockResolvedValue({
      simple: [
        {
          id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does",
          assignment: { provider_id: "p1", model: "m", mode: "cli" },
        },
      ],
      groups: [
        {
          id: "diagrams", label: "Diagrams",
          members: [{ id: "c1_agent", label: "C1 diagram skill", description: "what it does" }],
          assignment: null,
          cli_available: true,
        },
      ],
    });
    render(<SettingsDialog onDismiss={vi.fn()} />);

    expect(await screen.findByText("1 provider · 1 of 2 features routed")).toBeTruthy();
  });

  it("swaps itself for the tabbed LLM dialog", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("settings-open-llm")).toBeTruthy());

    fireEvent.click(screen.getByTestId("settings-open-llm"));

    await waitFor(() => expect(screen.getByTestId("llm-settings-panel")).toBeTruthy());
    expect(screen.queryByTestId("settings-open-llm")).toBeNull();
  });

  it("opens Updates from Settings", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("settings-open-updates"));
    expect(await screen.findByTestId("updates-panel")).toBeTruthy();
    expect(screen.getByText("Open CodeChroma in the desktop app to check and install updates.")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByTestId("settings-open-updates")).toBeTruthy();
  });

  it("dismisses", async () => {
    const { onDismiss } = renderDialog();
    await waitFor(() => expect(screen.getByTestId("assistant-dismiss")).toBeTruthy());

    fireEvent.click(screen.getByTestId("assistant-dismiss"));

    expect(onDismiss).toHaveBeenCalled();
  });
});
