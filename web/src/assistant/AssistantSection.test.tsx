import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantSection } from "./AssistantSection";
import * as llmClient from "../llm-settings/llmSettingsClient";

vi.mock("../llm-settings/llmSettingsClient", () => ({
  listProviders: vi.fn(),
  getCallSiteGroup: vi.fn(),
  assignCallSiteGroup: vi.fn(),
  clearCallSiteGroup: vi.fn(),
  fetchProviderModels: vi.fn(),
}));

const listProviders = vi.mocked(llmClient.listProviders);
const getCallSiteGroup = vi.mocked(llmClient.getCallSiteGroup);
const assignCallSiteGroup = vi.mocked(llmClient.assignCallSiteGroup);
const clearCallSiteGroup = vi.mocked(llmClient.clearCallSiteGroup);

function renderSection() {
  render(<AssistantSection />);
}

const CLI_PROVIDER = {
  id: "p2", label: "Claude CLI", kind: "cli" as const, adapter: "claude",
  transport: null, base_url: null, api_key_set: false, api_key_path: null, is_local: false,
  test_model: null,
  verify_ssl: true,
};

const GROUP = {
  id: "agents",
  label: "Agent windows",
  members: [],
  assignment: null as null | { provider_id: string; model: string },
  cli_available: true,
};

function mockProviders(defaultProviderId = "") {
  listProviders.mockResolvedValue([CLI_PROVIDER]);
  getCallSiteGroup.mockResolvedValue({
    ...GROUP,
    assignment: defaultProviderId === "" ? null : { provider_id: defaultProviderId, model: "claude-opus" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AssistantSection", () => {
  it("shows the provider section defaulting to Default when unassigned", async () => {
    mockProviders("");

    renderSection();

    await waitFor(() => expect(screen.getByTestId("assistant-provider")).toBeTruthy());
    expect(screen.getByTestId("assistant-provider")).toHaveValue("");
    expect(screen.getByTestId("assistant-provider-state")).toHaveTextContent("Default");
    // No provider selected yet -- Apply only appears once the choice diverges from saved.
    expect(screen.queryByTestId("assistant-provider-apply")).toBeNull();

    fireEvent.change(screen.getByTestId("assistant-provider"), { target: { value: "p2" } });
    await waitFor(() => expect(screen.getByTestId("assistant-provider-apply")).toBeTruthy());
  });

  it("pre-selects the routed provider and model when assigned", async () => {
    mockProviders("p2");

    renderSection();

    await waitFor(() => expect(screen.getByTestId("assistant-provider")).toBeTruthy());
    expect(screen.getByTestId("assistant-provider")).toHaveValue("p2");
    expect(screen.getByTestId("assistant-provider-model")).toHaveValue("claude-opus");
    expect(screen.getByTestId("assistant-provider-state")).toHaveTextContent("Routed");
  });

  it("applies a provider choice to the agents group", async () => {
    mockProviders("");
    assignCallSiteGroup.mockResolvedValue({
      ...GROUP,
      assignment: { provider_id: "p2", model: "claude-opus" },
    });

    renderSection();
    await waitFor(() => expect(screen.getByTestId("assistant-provider")).toBeTruthy());

    fireEvent.change(screen.getByTestId("assistant-provider"), { target: { value: "p2" } });
    fireEvent.change(screen.getByTestId("assistant-provider-model"), {
      target: { value: "claude-opus" },
    });
    await waitFor(() => fireEvent.click(screen.getByTestId("assistant-provider-apply")));

    expect(assignCallSiteGroup).toHaveBeenCalledWith("agents", {
      provider_id: "p2",
      model: "claude-opus",
    });
  });

  it("clears the provider assignment on reset", async () => {
    mockProviders("p2");
    clearCallSiteGroup.mockResolvedValue({ ...GROUP, assignment: null });

    renderSection();
    await waitFor(() => expect(screen.getByTestId("assistant-provider-reset")).toBeTruthy());

    fireEvent.click(screen.getByTestId("assistant-provider-reset"));

    expect(clearCallSiteGroup).toHaveBeenCalledWith("agents");
  });
});
