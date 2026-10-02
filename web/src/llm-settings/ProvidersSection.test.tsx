import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProvidersSection } from "./ProvidersSection";
import * as client from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  testProviderDraft: vi.fn(),
}));

const listProviders = vi.mocked(client.listProviders);
const createProvider = vi.mocked(client.createProvider);
const deleteProvider = vi.mocked(client.deleteProvider);
const testProvider = vi.mocked(client.testProvider);
const testProviderDraft = vi.mocked(client.testProviderDraft);

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProvidersSection", () => {
  it("lists the saved providers", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Local Ollama", kind: "api", adapter: null,
        transport: "openai-compatible", base_url: "http://localhost:11434/v1",
        api_key_set: false, api_key_path: null, is_local: true, test_model: null,
        verify_ssl: true,
      },
    ]);

    render(<ProvidersSection />);

    await waitFor(() => expect(screen.getByText("Local Ollama")).toBeTruthy());
  });

  it("shows a billing warning for a non-local api provider", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Anthropic", kind: "api", adapter: null, transport: "anthropic",
        base_url: null, api_key_set: true, api_key_path: null, is_local: false, test_model: null,
        verify_ssl: true,
      },
    ]);

    render(<ProvidersSection />);

    await waitFor(() =>
      expect(screen.getByTestId("llm-billing-warning-p1")).toBeTruthy(),
    );
  });

  it("does not warn for a local provider", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Local", kind: "api", adapter: null, transport: "openai-compatible",
        base_url: "http://x/v1", api_key_set: false, api_key_path: null, is_local: true, test_model: null,
        verify_ssl: true,
      },
    ]);

    render(<ProvidersSection />);

    await waitFor(() => expect(screen.getByText("Local")).toBeTruthy());
    expect(screen.queryByTestId("llm-billing-warning-p1")).toBeNull();
  });

  it("creates a cli provider from the add form", async () => {
    listProviders.mockResolvedValue([]);
    createProvider.mockResolvedValue({
      id: "p1", label: "Claude CLI", kind: "cli", adapter: "claude", transport: null,
      base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
      verify_ssl: true,
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());

    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-label"), {
      target: { value: "Claude CLI" },
    });
    await waitFor(() => fireEvent.click(screen.getByTestId("llm-provider-save")));

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Claude CLI", kind: "cli", adapter: "claude" }),
    );
  });

  it("sends a claude cli provider's custom base_url/api_key", async () => {
    listProviders.mockResolvedValue([]);
    createProvider.mockResolvedValue({
      id: "p1", label: "Claude via proxy", kind: "cli", adapter: "claude", transport: null,
      base_url: "https://proxy.example.com", api_key_set: true, api_key_path: null,
      is_local: false, test_model: null, verify_ssl: true,
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-label"), {
      target: { value: "Claude via proxy" },
    });
    fireEvent.change(screen.getByTestId("llm-provider-cli-base-url"), {
      target: { value: "https://proxy.example.com" },
    });
    fireEvent.change(screen.getByTestId("llm-provider-cli-api-key"), {
      target: { value: "sk-proxy" },
    });
    await waitFor(() => fireEvent.click(screen.getByTestId("llm-provider-save")));

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cli",
        adapter: "claude",
        base_url: "https://proxy.example.com",
        api_key: "sk-proxy",
      }),
    );
  });

  it("hides and clears the endpoint fields for a non-claude cli adapter", async () => {
    listProviders.mockResolvedValue([]);
    createProvider.mockResolvedValue({
      id: "p1", label: "Codex CLI", kind: "cli", adapter: "codex", transport: null,
      base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
      verify_ssl: true,
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-label"), {
      target: { value: "Codex CLI" },
    });
    fireEvent.change(screen.getByTestId("llm-provider-adapter"), {
      target: { value: "codex" },
    });

    expect(screen.queryByTestId("llm-provider-cli-base-url")).toBeNull();
    expect(screen.queryByTestId("llm-provider-cli-api-key")).toBeNull();

    await waitFor(() => fireEvent.click(screen.getByTestId("llm-provider-save")));

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cli", adapter: "codex", base_url: null, api_key: null }),
    );
  });

  it("shows the billing warning in the form for a non-local api draft", async () => {
    listProviders.mockResolvedValue([]);

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-kind"), { target: { value: "api" } });

    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-form-billing-warning")).toBeTruthy(),
    );
  });

  it("saves a test model for an openai-compatible provider", async () => {
    listProviders.mockResolvedValue([]);
    createProvider.mockResolvedValue({
      id: "p1", label: "Local", kind: "api", adapter: null, transport: "openai-compatible",
      base_url: "http://x/v1", api_key_set: false, api_key_path: null, is_local: true,
      test_model: "llama3",
      verify_ssl: true,
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-kind"), { target: { value: "api" } });
    fireEvent.change(screen.getByTestId("llm-provider-transport"), {
      target: { value: "openai-compatible" },
    });
    fireEvent.change(screen.getByTestId("llm-provider-test-model"), {
      target: { value: "llama3" },
    });
    await waitFor(() => fireEvent.click(screen.getByTestId("llm-provider-save")));

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ test_model: "llama3" }),
    );
  });

  it("checking 'skip certificate verification' sends verify_ssl: false", async () => {
    listProviders.mockResolvedValue([]);
    createProvider.mockResolvedValue({
      id: "p1", label: "deepseek", kind: "api", adapter: null, transport: "openai-compatible",
      base_url: "https://212.102.38.233:4443", api_key_set: false, api_key_path: null,
      is_local: true, test_model: "deepseek-v4-pro", verify_ssl: false,
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-kind"), { target: { value: "api" } });
    fireEvent.change(screen.getByTestId("llm-provider-transport"), {
      target: { value: "openai-compatible" },
    });
    fireEvent.click(screen.getByTestId("llm-provider-verify-ssl"));
    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-verify-ssl-warning")).toBeTruthy(),
    );
    await waitFor(() => fireEvent.click(screen.getByTestId("llm-provider-save")));

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ verify_ssl: false }),
    );
  });

  it("does not show the TLS warning by default", async () => {
    listProviders.mockResolvedValue([]);

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-kind"), { target: { value: "api" } });
    fireEvent.change(screen.getByTestId("llm-provider-transport"), {
      target: { value: "openai-compatible" },
    });

    expect(screen.queryByTestId("llm-provider-verify-ssl-warning")).toBeNull();
  });

  it("shows an insecure-TLS tag on a saved provider with verify_ssl off", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "deepseek", kind: "api", adapter: null, transport: "openai-compatible",
        base_url: "https://212.102.38.233:4443", api_key_set: true, api_key_path: null,
        is_local: false, test_model: "deepseek-v4-pro", verify_ssl: false,
      },
    ]);

    render(<ProvidersSection />);

    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-insecure-tls-p1")).toBeTruthy(),
    );
  });

  it("tests the draft from the add form before saving", async () => {
    listProviders.mockResolvedValue([]);
    testProviderDraft.mockResolvedValue({ ok: true, provider_id: null as never, message: "ok" });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.change(screen.getByTestId("llm-provider-label"), {
      target: { value: "Claude CLI" },
    });
    fireEvent.click(screen.getByTestId("llm-provider-form-test"));

    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-form-test-result").textContent).toMatch(/OK/),
    );
    expect(testProviderDraft).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Claude CLI", kind: "cli", adapter: "claude" }),
    );
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("shows a failed draft test result in the add form", async () => {
    listProviders.mockResolvedValue([]);
    testProviderDraft.mockResolvedValue({
      ok: false, provider_id: null as never, error: "connection refused",
    });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.click(screen.getByTestId("llm-provider-form-test"));

    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-form-test-result").textContent).toMatch(
        /connection refused/,
      ),
    );
  });

  it("discards a draft test result if the form is reopened before it resolves", async () => {
    listProviders.mockResolvedValue([]);
    let resolveTest: (result: client.ProviderTestResult) => void = () => {};
    testProviderDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveTest = resolve;
      }),
    );

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByTestId("llm-provider-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    fireEvent.click(screen.getByTestId("llm-provider-form-test"));
    await waitFor(() => expect(screen.getByTestId("llm-provider-form-test-result")).toBeTruthy());

    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByTestId("llm-provider-add"));
    resolveTest({ ok: true, provider_id: null as never, message: "ok" });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId("llm-provider-form-test-result")).toBeNull();
  });

  it("runs a connectivity test and shows the result", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Claude CLI", kind: "cli", adapter: "claude", transport: null,
        base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
        verify_ssl: true,
      },
    ]);
    testProvider.mockResolvedValue({ ok: true, provider_id: "p1", message: "ok" });

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByText("Claude CLI")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Test")[0]);

    await waitFor(() =>
      expect(screen.getByTestId("llm-provider-test-p1").textContent).toMatch(/OK/),
    );
  });

  it("deletes a provider", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Claude CLI", kind: "cli", adapter: "claude", transport: null,
        base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
        verify_ssl: true,
      },
    ]);
    deleteProvider.mockResolvedValue(undefined);

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByText("Claude CLI")).toBeTruthy());
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith("p1"));
  });

  it("surfaces a delete error naming the blocking call site", async () => {
    listProviders.mockResolvedValue([
      {
        id: "p1", label: "Claude CLI", kind: "cli", adapter: "claude", transport: null,
        base_url: null, api_key_set: false, api_key_path: null, is_local: false, test_model: null,
        verify_ssl: true,
      },
    ]);
    deleteProvider.mockRejectedValue(new Error("provider is still assigned to ai_summarizer"));

    render(<ProvidersSection />);
    await waitFor(() => expect(screen.getByText("Claude CLI")).toBeTruthy());
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.getByText(/ai_summarizer/)).toBeTruthy());
  });
});
