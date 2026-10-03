import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CallSitesSection } from "./CallSitesSection";
import * as client from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  listCallSites: vi.fn(),
  listProviders: vi.fn(),
  assignCallSite: vi.fn(),
  clearCallSite: vi.fn(),
  assignCallSiteGroup: vi.fn(),
  clearCallSiteGroup: vi.fn(),
  fetchProviderModels: vi.fn(),
}));

const listCallSites = vi.mocked(client.listCallSites);
const listProviders = vi.mocked(client.listProviders);
const assignCallSite = vi.mocked(client.assignCallSite);
const assignCallSiteGroup = vi.mocked(client.assignCallSiteGroup);
const fetchProviderModels = vi.mocked(client.fetchProviderModels);

afterEach(() => {
  vi.clearAllMocks();
});

const API_PROVIDER = {
  id: "p1", label: "Local Ollama", kind: "api" as const, adapter: null,
  transport: "openai-compatible" as const, base_url: "http://x/v1",
  api_key_set: false, api_key_path: null, is_local: true, test_model: null,
  verify_ssl: true,
};

const CLI_PROVIDER = {
  id: "p2", label: "Claude CLI", kind: "cli" as const, adapter: "claude",
  transport: null, base_url: null, api_key_set: false, api_key_path: null, is_local: false,
  test_model: null,
  verify_ssl: true,
};

const PLANNING_GROUP = {
  id: "planning", label: "Planning",
  members: [{ id: "epic_brief_agent", label: "Epic-brief skill", description: "what it does" }],
  assignment: null,
  cli_available: true,
};

describe("CallSitesSection", () => {
  it("lists every simple call site and every group", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [PLANNING_GROUP],
    });
    listProviders.mockResolvedValue([]);

    render(<CallSitesSection />);

    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());
    expect(screen.getByText("Planning")).toBeTruthy();
    expect(screen.getByText("Epic-brief skill")).toBeTruthy();
  });

  it("shows the mode toggle only for a simple call site, never for a group", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [PLANNING_GROUP],
    });
    listProviders.mockResolvedValue([]);

    render(<CallSitesSection />);

    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-mode-ai_summarizer")).toBeTruthy(),
    );
    expect(screen.queryByTestId("llm-call-site-group-mode-planning")).toBeNull();
  });

  it("only offers cli providers for a group", async () => {
    listCallSites.mockResolvedValue({ simple: [], groups: [PLANNING_GROUP] });
    listProviders.mockResolvedValue([API_PROVIDER, CLI_PROVIDER]);

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("Planning")).toBeTruthy());

    const select = screen.getByTestId("llm-call-site-group-provider-planning") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("Claude CLI");
    expect(options).not.toContain("Local Ollama");
  });

  it("assigns a provider to a simple call site", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER]);
    assignCallSite.mockResolvedValue({
      id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does",
      assignment: { provider_id: "p1", model: "llama3", mode: "api" },
    });

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());

    fireEvent.change(screen.getByTestId("llm-call-site-provider-ai_summarizer"), {
      target: { value: "p1" },
    });
    fireEvent.change(screen.getByTestId("llm-call-site-model-ai_summarizer"), {
      target: { value: "llama3" },
    });
    fireEvent.click(screen.getByTestId("llm-call-site-assign-ai_summarizer"));

    await waitFor(() =>
      expect(assignCallSite).toHaveBeenCalledWith("ai_summarizer", {
        provider_id: "p1", model: "llama3", mode: "api",
      }),
    );
  });

  it("assigns one provider to a whole group of agentic call sites", async () => {
    const diagramsGroup = {
      id: "diagrams", label: "Diagrams",
      members: [
        { id: "c1_agent", label: "C1 diagram skill", description: "d1" },
        { id: "patterns_agent", label: "Patterns diagram skill", description: "d2" },
      ],
      assignment: null,
      cli_available: true,
    };
    listCallSites.mockResolvedValue({ simple: [], groups: [diagramsGroup] });
    listProviders.mockResolvedValue([CLI_PROVIDER]);
    assignCallSiteGroup.mockResolvedValue({
      ...diagramsGroup, assignment: { provider_id: "p2", model: "claude-opus" },
    });

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("Diagrams")).toBeTruthy());
    expect(screen.getByText("C1 diagram skill, Patterns diagram skill")).toBeTruthy();

    fireEvent.change(screen.getByTestId("llm-call-site-group-provider-diagrams"), {
      target: { value: "p2" },
    });
    fireEvent.change(screen.getByTestId("llm-call-site-group-model-diagrams"), {
      target: { value: "claude-opus" },
    });
    fireEvent.click(screen.getByTestId("llm-call-site-group-assign-diagrams"));

    await waitFor(() =>
      expect(assignCallSiteGroup).toHaveBeenCalledWith("diagrams", {
        provider_id: "p2", model: "claude-opus",
      }),
    );
  });

  it("explains what each feature does behind a help marker", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        {
          id: "ai_summarizer", label: "AI summarizer", capability: "simple",
          description: "Writes the one-line summary on every block.", assignment: null,
        },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([]);

    render(<CallSitesSection />);

    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-help-ai_summarizer")).toBeTruthy(),
    );
    fireEvent.focus(screen.getByTestId("llm-call-site-help-ai_summarizer"));

    expect(screen.getByText("Writes the one-line summary on every block.")).toBeTruthy();
  });

  it("shows a billing warning next to a call site assigned to a non-local api provider", async () => {
    const nonLocal = { ...API_PROVIDER, id: "p3", is_local: false };
    listCallSites.mockResolvedValue({
      simple: [
        {
          id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does",
          assignment: { provider_id: "p3", model: "m", mode: "api" },
        },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([nonLocal]);

    render(<CallSitesSection />);

    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-billing-warning-ai_summarizer")).toBeTruthy(),
    );
  });

  it("clears the picked provider when switching mode away from its kind", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER, CLI_PROVIDER]);

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());

    const providerSelect = screen.getByTestId(
      "llm-call-site-provider-ai_summarizer",
    ) as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: "p1" } });
    expect(providerSelect.value).toBe("p1");

    fireEvent.change(screen.getByTestId("llm-call-site-mode-ai_summarizer"), {
      target: { value: "cli" },
    });

    expect(providerSelect.value).toBe("");
  });

  it("does not show a billing warning for a call site assigned to a local provider", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        {
          id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does",
          assignment: { provider_id: "p1", model: "m", mode: "api" },
        },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER]);

    render(<CallSitesSection />);

    await waitFor(() => expect(screen.getByText(/AI summarizer/)).toBeTruthy());
    expect(screen.queryByTestId("llm-call-site-billing-warning-ai_summarizer")).toBeNull();
  });

  it("disables Fetch models until a provider is picked, then fetches and lists options", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER]);
    fetchProviderModels.mockResolvedValue({
      supported: true,
      models: [{ id: "llama3", label: null }, { id: "mistral", label: "Mistral" }],
    });

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());

    const fetchButton = screen.getByTestId("llm-call-site-fetch-models-ai_summarizer");
    expect(fetchButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("llm-call-site-provider-ai_summarizer"), {
      target: { value: "p1" },
    });
    expect(fetchButton).not.toBeDisabled();

    fireEvent.click(fetchButton);

    await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-models-status-ai_summarizer").textContent).toBe(
        "2 models available",
      ),
    );
    const input = screen.getByTestId("llm-call-site-model-ai_summarizer") as HTMLInputElement;
    const datalist = document.getElementById(input.getAttribute("list")!) as HTMLDataListElement;
    const optionValues = Array.from(datalist.options).map((o) => o.value);
    expect(optionValues).toEqual(["llama3", "mistral"]);
  });

  it("shows the unsupported hint instead of options when the provider can't list models", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER]);
    fetchProviderModels.mockResolvedValue({ supported: false, models: [] });

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());

    fireEvent.change(screen.getByTestId("llm-call-site-provider-ai_summarizer"), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByTestId("llm-call-site-fetch-models-ai_summarizer"));

    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-models-status-ai_summarizer").textContent).toBe(
        "This provider can't list its models — type the name directly.",
      ),
    );
  });

  it("shows the error text when the models fetch throws", async () => {
    listCallSites.mockResolvedValue({
      simple: [
        { id: "ai_summarizer", label: "AI summarizer", capability: "simple", description: "what it does", assignment: null },
      ],
      groups: [],
    });
    listProviders.mockResolvedValue([API_PROVIDER]);
    fetchProviderModels.mockRejectedValue(new Error("connection refused"));

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("AI summarizer")).toBeTruthy());

    fireEvent.change(screen.getByTestId("llm-call-site-provider-ai_summarizer"), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByTestId("llm-call-site-fetch-models-ai_summarizer"));

    await waitFor(() =>
      expect(screen.getByTestId("llm-call-site-models-status-ai_summarizer").textContent).toBe(
        "connection refused",
      ),
    );
  });

  it("also offers Fetch models on a group row", async () => {
    const diagramsGroup = {
      id: "diagrams", label: "Diagrams",
      members: [{ id: "c1_agent", label: "C1 diagram skill", description: "d1" }],
      assignment: null,
      cli_available: true,
    };
    listCallSites.mockResolvedValue({ simple: [], groups: [diagramsGroup] });
    listProviders.mockResolvedValue([CLI_PROVIDER]);
    fetchProviderModels.mockResolvedValue({ supported: true, models: [{ id: "sonnet", label: null }] });

    render(<CallSitesSection />);
    await waitFor(() => expect(screen.getByText("Diagrams")).toBeTruthy());

    const fetchButton = screen.getByTestId("llm-call-site-group-fetch-models-diagrams");
    expect(fetchButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("llm-call-site-group-provider-diagrams"), {
      target: { value: "p2" },
    });
    fireEvent.click(fetchButton);

    await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledWith("p2"));
    await waitFor(() =>
      expect(
        screen.getByTestId("llm-call-site-group-models-status-diagrams").textContent,
      ).toBe("1 model available"),
    );
  });
});
