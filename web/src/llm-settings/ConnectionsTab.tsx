import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { messageOf } from "../util/reportError";
import { BillingWarningBadge } from "./BillingWarningBadge";
import { capabilityText, capabilityWhy, connectionSubtitle } from "./capability";
import {
  createProvider,
  deleteProvider,
  fetchCliStatus,
  fetchDraftCapabilities,
  listProviders,
  testProvider,
  testProviderDraft,
  updateProvider,
  type Capabilities,
  type CliStatus,
  type Provider,
  type ProviderDraft,
  type ProviderKind,
  type ProviderTestResult,
  type Transport,
} from "./llmSettingsClient";

/** Shared OK/Failed shaping for a test result -- used by both the saved-row and form Test buttons. */
function formatTestResult(
  result: ProviderTestResult,
  kind?: ProviderKind,
  seconds?: number,
): { ok: boolean; text: string } {
  const found = result.models_count ? `${result.models_count} models found` : null;
  if (result.ok && kind === "cli" && seconds !== undefined) {
    return { ok: true, text: [`Works · replied in ${seconds.toFixed(1)} s`, found].filter(Boolean).join(" · ") };
  }
  if (result.ok && kind === "api") {
    return { ok: true, text: `Connected · ${found ?? result.message ?? "reachable"}` };
  }
  return result.ok
    ? { ok: true, text: `Works · ${result.message ?? "reachable"}` }
    : { ok: false, text: `Failed: ${result.error ?? ""}` };
}

/** The "claude found on PATH" line: resolves the adapter's executable through the runtime route. */
function useCliStatus(adapter: string | null): CliStatus | null {
  const [status, setStatus] = useState<CliStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    if (!adapter) return;
    let stale = false;
    fetchCliStatus(adapter)
      .then((result) => !stale && setStatus(result))
      .catch(() => !stale && setStatus(null));
    return () => {
      stale = true;
    };
  }, [adapter]);
  return status;
}

/** The "skip certificate verification" checkbox and its man-in-the-middle warning. */
function TlsToggle({ testId, skip, onChange }: { testId: string; skip: boolean; onChange: (skip: boolean) => void }) {
  return (
    <div className="llm-field">
      <span className="llm-field-label">TLS</span>
      <label className="llm-check">
        <input type="checkbox" data-testid={testId} checked={skip} onChange={(e) => onChange(e.target.checked)} />
        <span>Skip certificate verification (self-signed / private CA)</span>
      </label>
      {skip && (
        <p className="llm-status-fail" data-testid={`${testId}-warning`} aria-live="polite">
          Insecure: the connection is not protected against a man-in-the-middle. Only use this for a
          trusted internal host.
        </p>
      )}
    </div>
  );
}

/** Key-field copy per connection type. */
function keyCopy(draft: { kind: ProviderKind; transport: Transport }): { label: string; hint: string } {
  if (draft.kind === "cli") {
    return { label: "Proxy API key", hint: "Sent to your endpoint instead of the default Anthropic API." };
  }
  if (draft.transport === "gemini") {
    return { label: "Gemini API key", hint: "Create one in Google AI Studio." };
  }
  if (draft.transport === "anthropic") {
    return { label: "Anthropic API key", hint: "Create one at console.anthropic.com." };
  }
  return { label: "API key (optional)", hint: "Leave blank for a local server that needs no key." };
}

const CLI_ADAPTERS = ["claude", "codex", "kimi-cli"];
const TRANSPORTS: Transport[] = ["anthropic", "gemini", "openai-compatible"];

interface FormDraft {
  label: string;
  kind: ProviderKind;
  adapter: string;
  transport: Transport;
  baseUrl: string;
  apiKey: string;
  /** Whether the stored provider already has a key, so an untouched field keeps it (round-trip). */
  hadKey: boolean;
  isLocal: boolean;
  /** The model the "Test" button probes with for an openai-compatible transport. */
  testModel: string;
  /** openai-compatible only: checked skips TLS cert verification (self-signed/private CA). */
  skipTls: boolean;
  /** claude CLI only: route through a custom Anthropic-protocol endpoint. */
  useProxy: boolean;
}

const EMPTY_DRAFT: FormDraft = {
  label: "",
  kind: "cli",
  adapter: "claude",
  transport: "anthropic",
  baseUrl: "",
  apiKey: "",
  hadKey: false,
  isLocal: false,
  testModel: "",
  skipTls: false,
  useProxy: false,
};

function toFormDraft(provider: Provider): FormDraft {
  return {
    label: provider.label,
    kind: provider.kind,
    adapter: provider.adapter ?? "claude",
    transport: provider.transport ?? "anthropic",
    baseUrl: provider.base_url ?? "",
    apiKey: "",
    hadKey: provider.api_key_set,
    isLocal: provider.is_local,
    testModel: provider.test_model ?? "",
    skipTls: !provider.verify_ssl,
    useProxy: !!provider.base_url || provider.api_key_set,
  };
}

function toPayload(draft: FormDraft): ProviderDraft {
  const base = { label: draft.label, kind: draft.kind };
  const keyUntouched = draft.apiKey === "" && draft.hadKey;
  if (draft.kind === "cli") {
    // Only the "claude" adapter reads base_url/api_key (a custom Anthropic-protocol proxy) --
    // any other adapter always clears them, same as today.
    const usesEndpoint = draft.adapter === "claude" && draft.useProxy;
    return {
      ...base,
      adapter: draft.adapter,
      transport: null,
      base_url: usesEndpoint ? draft.baseUrl || null : null,
      ...(usesEndpoint && keyUntouched
        ? { api_key_set: true }
        : { api_key: usesEndpoint ? draft.apiKey || null : null, api_key_set: false }),
      api_key_path: null,
      is_local: false,
      test_model: null,
      verify_ssl: usesEndpoint ? !draft.skipTls : true,
    };
  }
  const isGemini = draft.transport === "gemini";
  const usesBaseUrl = isGemini || draft.transport === "openai-compatible";
  return {
    ...base,
    adapter: null,
    transport: draft.transport,
    base_url: usesBaseUrl ? draft.baseUrl || null : null,
    // Untouched + previously set: omit api_key and keep api_key_set so the store leaves it as-is.
    ...(keyUntouched ? { api_key_set: true } : { api_key: draft.apiKey || null, api_key_set: false }),
    api_key_path: null,
    is_local: draft.isLocal,
    // Only openai-compatible takes a test_model / TLS toggle; gemini uses its own probe model
    // and its own always-verified Google endpoint.
    test_model: isGemini ? null : draft.testModel || null,
    verify_ssl: isGemini ? true : !draft.skipTls,
  };
}

/** The Add form's type picker: two groups, each type presetting the kind/adapter/transport below. */
const CONNECTION_TYPES: {
  id: string;
  group: "cli" | "api";
  name: string;
  blurb: string;
  preset: Partial<FormDraft>;
}[] = [
  { id: "claude", group: "cli", name: "Claude Code", blurb: "Uses your claude sign-in", preset: { kind: "cli", adapter: "claude", label: "Claude Code" } },
  { id: "codex", group: "cli", name: "Codex CLI", blurb: "Uses your codex sign-in", preset: { kind: "cli", adapter: "codex", label: "Codex CLI" } },
  { id: "kimi", group: "cli", name: "Kimi CLI", blurb: "Uses your kimi sign-in", preset: { kind: "cli", adapter: "kimi-cli", label: "Kimi CLI" } },
  { id: "anthropic", group: "api", name: "Anthropic", blurb: "API key from console.anthropic.com", preset: { kind: "api", transport: "anthropic", label: "Anthropic", isLocal: false } },
  { id: "gemini", group: "api", name: "Gemini", blurb: "API key from Google AI Studio", preset: { kind: "api", transport: "gemini", label: "Gemini", isLocal: false } },
  { id: "openai", group: "api", name: "OpenAI-compatible / local", blurb: "Ollama, LM Studio, vLLM, LiteLLM, any /v1 server", preset: { kind: "api", transport: "openai-compatible", label: "Local · Ollama", isLocal: true, baseUrl: "http://localhost:11434/v1" } },
];

/** Connections list (capability, usage, test/edit/delete) and the Add/Edit form with its type picker. */
export function ConnectionsTab({
  startAdding = false,
  footerSlot = null,
  onFormOpenChange,
}: {
  startAdding?: boolean;
  /** Where the form's Test / Cancel / Add buttons render (the dialog footer); inline when absent. */
  footerSlot?: HTMLElement | null;
  onFormOpenChange?: (open: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(startAdding ? "new" : null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState(false);
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [formTesting, setFormTesting] = useState(false);
  // Bumped whenever the form's identity changes, so a test started on an earlier draft can't
  // land its result on a since-reopened/switched form.
  const formGenerationRef = useRef(0);

  const formOpen = editingId !== null;
  useEffect(() => {
    onFormOpenChange?.(formOpen);
    return () => onFormOpenChange?.(false);
  }, [formOpen, onFormOpenChange]);

  const refresh = () =>
    listProviders()
      .then(setProviders)
      .catch((err) => setError(messageOf(err)));

  useEffect(() => {
    refresh();
  }, []);

  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setFormTestResult(null);
  };

  const openForm = (next: FormDraft, id: string) => {
    formGenerationRef.current += 1;
    setDraft(next);
    setEditingId(id);
    setFormTestResult(null);
    setFormTesting(false);
  };
  const startCreate = () => openForm(EMPTY_DRAFT, "new");
  const startEdit = (provider: Provider) => openForm(toFormDraft(provider), provider.id);

  const runFormTest = async () => {
    const generation = formGenerationRef.current;
    setFormTesting(true);
    setFormTestResult(null);
    try {
      const started = performance.now();
      const result = await testProviderDraft(toPayload(draft));
      const seconds = (performance.now() - started) / 1000;
      if (formGenerationRef.current === generation) {
        setFormTestResult(formatTestResult(result, draft.kind, seconds));
      }
    } catch (err) {
      if (formGenerationRef.current === generation) {
        setFormTestResult({ ok: false, text: `Failed: ${messageOf(err)}` });
      }
    } finally {
      if (formGenerationRef.current === generation) setFormTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(draft);
      if (editingId === "new") {
        await createProvider(payload);
      } else if (editingId) {
        await updateProvider(editingId, payload);
      }
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteProvider(id);
      refresh();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const runTest = async (id: string) => {
    setTestResults((r) => ({ ...r, [id]: { ok: true, text: "Testing…" } }));
    try {
      const result = await testProvider(id);
      setTestResults((r) => ({ ...r, [id]: formatTestResult(result) }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [id]: { ok: false, text: `Failed: ${messageOf(err)}` } }));
    }
  };

  const rows = providers ?? [];

  // Runtime-parametric over transport: gemini and openai-compatible carry a base_url; only
  // openai-compatible takes a test_model / TLS toggle.
  const hasKey = draft.apiKey !== "" || draft.hadKey;
  const [draftCaps, setDraftCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    if (editingId === null) return;
    let stale = false;
    fetchDraftCapabilities({
      kind: draft.kind,
      adapter: draft.adapter,
      transport: draft.transport,
      api_key_set: hasKey,
    })
      .then((result) => !stale && setDraftCaps(result.capabilities))
      .catch(() => !stale && setDraftCaps(null));
    return () => {
      stale = true;
    };
  }, [editingId, draft.kind, draft.adapter, draft.transport, hasKey]);
  const isGemini = draft.transport === "gemini";
  const cliStatus = useCliStatus(editingId !== null && draft.kind === "cli" ? draft.adapter : null);
  const copy = keyCopy(draft);
  const usesBaseUrl = isGemini || draft.transport === "openai-compatible";

  const formButtons = (
    <div className="llm-card-footer llm-form-buttons">
            <button
              type="button"
              className="llm-button-ghost"
              disabled={formTesting}
              data-testid="llm-provider-form-test"
              onClick={() => void runFormTest()}
            >
              Test
            </button>
            <button type="button" className="llm-button-ghost" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="llm-button-primary"
              disabled={busy}
              data-testid="llm-provider-save"
              onClick={() => void save()}
            >
              {editingId === "new" ? "Add connection" : "Save"}
            </button>
          </div>
  );

  return (
    <div className="llm-tab-body" data-testid="llm-providers-section">
      <div className="llm-tab-head">
        <p className="llm-tab-hint">
          A connection is a way to reach a model: a CLI tool you're signed in to, an API key, or a
          local server. Add it once, then use it anywhere.
        </p>
      </div>

      {error && (
        <p className="llm-status-fail" aria-live="polite">
          {error}
        </p>
      )}

      {providers !== null && rows.length === 0 && editingId === null && (
        <div className="llm-empty">
          <p>No connections yet.</p>
          <p className="llm-empty-hint">
            Add one to pick a default model. Until then every feature keeps its current behavior.
          </p>
        </div>
      )}

      {editingId === null && (
        <button
          type="button"
          className="llm-button-primary llm-add-connection"
          data-testid="llm-provider-add"
          onClick={startCreate}
        >
          + Add a connection
        </button>
      )}

      {editingId !== "new" && (
        <ul className="llm-providers-list">
          {rows.map((provider) => {
            const result = testResults[provider.id];
            return (
              <li
                key={provider.id}
                className="llm-card llm-provider-card"
                data-testid={`llm-provider-row-${provider.id}`}
              >
                <div className="llm-provider-card-main">
                  <div className="llm-provider-identity">
                    <span className="llm-provider-name">{provider.label}</span>
                    <span className="llm-provider-sub">{connectionSubtitle(provider)}</span>
                  </div>
                  <div className="llm-provider-actions">
                    <button
                      type="button"
                      className="llm-button-ghost"
                      onClick={() => void runTest(provider.id)}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="llm-button-ghost"
                      onClick={() => startEdit(provider)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="llm-button-ghost llm-button-danger"
                      onClick={() => void remove(provider.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="llm-tag-row">
                  {provider.capabilities && (
                    <span
                      className="llm-tag llm-tag-accent"
                      data-testid={`llm-provider-capability-${provider.id}`}
                    >
                      {capabilityText(provider.capabilities)}
                    </span>
                  )}
                  {provider.used_by !== undefined && (
                    <span
                      className="llm-tag llm-tag-quiet"
                      data-testid={`llm-provider-used-by-${provider.id}`}
                    >
                      {provider.used_by === 0
                        ? "Not used"
                        : `Used by ${provider.used_by} ${provider.used_by === 1 ? "feature" : "features"}`}
                    </span>
                  )}
                  <span className="llm-tag">
                    {provider.kind === "cli" ? provider.adapter : provider.transport}
                  </span>
                  {provider.is_local && <span className="llm-tag llm-tag-good">local</span>}
                  {provider.kind === "api" && !provider.is_local && (
                    <span className={`llm-tag${provider.api_key_set ? " llm-tag-good" : " llm-tag-warn"}`}>
                      {provider.api_key_set ? "key set" : "no key"}
                    </span>
                  )}
                  {((provider.kind === "api" && provider.transport === "openai-compatible") ||
                    (provider.kind === "cli" && provider.adapter === "claude")) &&
                    !provider.verify_ssl && (
                      <span
                        className="llm-tag llm-tag-warn"
                        data-testid={`llm-provider-insecure-tls-${provider.id}`}
                      >
                        TLS verification off
                      </span>
                  )}
                  <BillingWarningBadge
                    provider={provider}
                    testId={`llm-billing-warning-${provider.id}`}
                  />
                </div>

                {result && (
                  <p
                    className={result.ok ? "llm-status-ok" : "llm-status-fail"}
                    data-testid={`llm-provider-test-${provider.id}`}
                    aria-live="polite"
                  >
                    {result.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editingId !== null && (
        <div className="llm-card llm-provider-form">
          <div className="llm-form-head">
            <button
              type="button"
              className="llm-button-ghost"
              aria-label="Back to connections"
              data-testid="llm-provider-back"
              onClick={() => setEditingId(null)}
            >
              ←
            </button>
            <div>
              <h3 className="llm-card-title">
                {editingId === "new" ? "Add a connection" : "Edit connection"}
              </h3>
              {editingId === "new" && (
                <p className="llm-subtle">How should CodeChroma reach a model?</p>
              )}
            </div>
          </div>

          {editingId === "new" && (
            <div className="llm-type-picker" data-testid="llm-type-picker">
              {(["cli", "api"] as const).map((group) => (
                <div key={group} className="llm-step">
                  <span className="llm-step-label">
                    {group === "cli" ? "CLI tools you're signed in to" : "API key or server"}
                  </span>
                  <div className="llm-chip-grid">
                    {CONNECTION_TYPES.filter((t) => t.group === group).map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        className="llm-chip"
                        data-testid={`llm-type-${type.id}`}
                        onClick={() => {
                          setDraft({ ...EMPTY_DRAFT, ...type.preset });
                          setFormTestResult(null);
                        }}
                      >
                        <span className="llm-chip-name">{type.name}</span>
                        <span className="llm-chip-sub">{type.blurb}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {draftCaps && (
            <p className="llm-capability-strip" data-testid="llm-form-capability">
              Can be used for <strong>{capabilityText(draftCaps)}</strong> ·{" "}
              {capabilityWhy(draftCaps)}
            </p>
          )}

          {draft.kind === "cli" && cliStatus && (
            <p
              className={cliStatus.executable ? "llm-status-ok" : "llm-status-fail"}
              data-testid="llm-form-cli-status"
            >
              {cliStatus.executable
                ? `${draft.adapter} found on PATH${cliStatus.version ? ` · ${cliStatus.version}` : ""}${cliStatus.signed_in === true ? " · signed in" : cliStatus.signed_in === false ? " · not signed in" : ""}`
                : `${draft.adapter} not found on PATH${cliStatus.failure_reason ? ` · ${cliStatus.failure_reason}` : ""}`}
            </p>
          )}

          <div className="llm-field-grid">
            <label className="llm-field">
              <span className="llm-field-label">Name</span>
              <input
                data-testid="llm-provider-label"
                placeholder="e.g. Local Ollama"
                value={draft.label}
                onChange={(e) => set("label", e.target.value)}
              />
            </label>
            {editingId !== "new" && (
            <label className="llm-field">
              <span className="llm-field-label">Connect via</span>
              <select
                data-testid="llm-provider-kind"
                value={draft.kind}
                onChange={(e) => set("kind", e.target.value as ProviderKind)}
              >
                <option value="cli">Command-line tool</option>
                <option value="api">Direct API</option>
              </select>
            </label>
            )}

            {draft.kind === "cli" ? (
              <>
                {editingId !== "new" && (
                <label className="llm-field">
                  <span className="llm-field-label">CLI adapter</span>
                  <select
                    data-testid="llm-provider-adapter"
                    value={draft.adapter}
                    onChange={(e) => set("adapter", e.target.value)}
                  >
                    {CLI_ADAPTERS.map((adapter) => (
                      <option key={adapter} value={adapter}>
                        {adapter}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                {draft.adapter === "claude" && (
                  <label className="llm-check">
                    <input
                      type="checkbox"
                      data-testid="llm-provider-cli-use-proxy"
                      checked={draft.useProxy}
                      onChange={(e) => set("useProxy", e.target.checked)}
                    />
                    <span>Route through my own endpoint</span>
                  </label>
                )}
                {draft.adapter === "claude" && draft.useProxy && (
                  <>
                    <label className="llm-field">
                      <span className="llm-field-label">Base URL</span>
                      <input
                        data-testid="llm-provider-cli-base-url"
                        placeholder="https://your-proxy.example.com"
                        value={draft.baseUrl}
                        onChange={(e) => set("baseUrl", e.target.value)}
                      />
                    </label>
                    <label className="llm-field">
                      <span className="llm-field-label">{copy.label}</span>
                      <input
                        type="password"
                        data-testid="llm-provider-cli-api-key"
                        aria-label="API key"
                        placeholder={
                          draft.hadKey ? "Unchanged (leave blank to keep)" : "API key — sk-…"
                        }
                        value={draft.apiKey}
                        onChange={(e) => set("apiKey", e.target.value)}
                      />
                    </label>
                    <p className="llm-field-hint">
                      {copy.hint} The endpoint must speak the Anthropic Messages API, not an
                      OpenAI-compatible one.
                    </p>
                    <TlsToggle
                      testId="llm-provider-cli-verify-ssl"
                      skip={draft.skipTls}
                      onChange={(skip) => set("skipTls", skip)}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {editingId !== "new" && (
                <label className="llm-field">
                  <span className="llm-field-label">Transport</span>
                  <select
                    data-testid="llm-provider-transport"
                    value={draft.transport}
                    onChange={(e) => set("transport", e.target.value as Transport)}
                  >
                    {TRANSPORTS.map((transport) => (
                      <option key={transport} value={transport}>
                        {transport}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                {usesBaseUrl && (
                  <label className="llm-field">
                    <span className="llm-field-label">
                      {isGemini ? "Base URL (optional)" : "Base URL"}
                    </span>
                    <input
                      data-testid="llm-provider-base-url"
                      placeholder={
                        isGemini
                          ? "https://generativelanguage.googleapis.com"
                          : "http://localhost:11434/v1"
                      }
                      value={draft.baseUrl}
                      onChange={(e) => set("baseUrl", e.target.value)}
                    />
                  </label>
                )}
                {draft.transport === "openai-compatible" && (
                  <>
                    <label className="llm-field">
                      <span className="llm-field-label">Test model</span>
                      <input
                        data-testid="llm-provider-test-model"
                        placeholder="e.g. llama3 — used only by Test"
                        value={draft.testModel}
                        onChange={(e) => set("testModel", e.target.value)}
                      />
                    </label>
                    <TlsToggle
                      testId="llm-provider-verify-ssl"
                      skip={draft.skipTls}
                      onChange={(skip) => set("skipTls", skip)}
                    />
                  </>
                )}
                <div className="llm-field">
                  <span className="llm-field-label">{copy.label}</span>
                  <label className="llm-check">
                    <input
                      type="checkbox"
                      data-testid="llm-provider-is-local"
                      checked={draft.isLocal}
                      onChange={(e) => set("isLocal", e.target.checked)}
                    />
                    <span>Local model — no key needed</span>
                  </label>
                  {!draft.isLocal && (
                    <>
                    <input
                      type="password"
                      data-testid="llm-provider-api-key"
                      aria-label="API key"
                      placeholder={draft.hadKey ? "Unchanged (leave blank to keep)" : "API key — sk-…"}
                      value={draft.apiKey}
                      onChange={(e) => set("apiKey", e.target.value)}
                    />
                    <p className="llm-field-hint">{copy.hint}</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {draft.kind === "api" && (
            <div className="llm-tag-row">
              <BillingWarningBadge
                provider={{ kind: draft.kind, is_local: draft.isLocal }}
                testId="llm-provider-form-billing-warning"
              />
            </div>
          )}

          {(formTesting || formTestResult) && (
            <p
              className={formTesting || formTestResult!.ok ? "llm-status-ok" : "llm-status-fail"}
              data-testid="llm-provider-form-test-result"
              aria-live="polite"
            >
              {formTesting ? "Testing…" : formTestResult!.text}
            </p>
          )}

          {footerSlot ? createPortal(formButtons, footerSlot) : formButtons}
        </div>
      )}
    </div>
  );
}
