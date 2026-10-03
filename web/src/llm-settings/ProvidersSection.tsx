import { useEffect, useRef, useState } from "react";
import { messageOf } from "../util/reportError";
import { BillingWarningBadge } from "./BillingWarningBadge";
import {
  createProvider,
  deleteProvider,
  listProviders,
  testProvider,
  testProviderDraft,
  updateProvider,
  type Provider,
  type ProviderDraft,
  type ProviderKind,
  type ProviderTestResult,
  type Transport,
} from "./llmSettingsClient";

/** Shared OK/Failed shaping for a test result -- used by both the saved-row and form Test buttons. */
function formatTestResult(result: ProviderTestResult): { ok: boolean; text: string } {
  return result.ok
    ? { ok: true, text: `OK: ${result.message ?? "reachable"}` }
    : { ok: false, text: `Failed: ${result.error ?? ""}` };
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
  };
}

function toPayload(draft: FormDraft): ProviderDraft {
  const base = { label: draft.label, kind: draft.kind };
  const keyUntouched = draft.apiKey === "" && draft.hadKey;
  if (draft.kind === "cli") {
    // Only the "claude" adapter reads base_url/api_key (a custom Anthropic-protocol proxy) --
    // any other adapter always clears them, same as today.
    const usesEndpoint = draft.adapter === "claude";
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

/** The one-line "what is this connection" subtitle under a provider's name. */
function subtitleOf(provider: Provider): string {
  if (provider.kind === "cli") {
    return provider.base_url
      ? `${provider.adapter} → ${provider.base_url}`
      : `Runs the ${provider.adapter} command-line tool`;
  }
  if (provider.transport === "anthropic") return "Anthropic API";
  if (provider.transport === "gemini") return provider.base_url || "Gemini API";
  return provider.base_url || "openai-compatible endpoint";
}

/** Providers list, add/edit/delete, a kind-branching form, and an on-demand connectivity test. */
export function ProvidersSection() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState(false);
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [formTesting, setFormTesting] = useState(false);
  // Bumped whenever the form's identity changes, so a test started on an earlier draft can't
  // land its result on a since-reopened/switched form.
  const formGenerationRef = useRef(0);

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

  const startCreate = () => {
    formGenerationRef.current += 1;
    setDraft(EMPTY_DRAFT);
    setEditingId("new");
    setFormTestResult(null);
    setFormTesting(false);
  };

  const startEdit = (provider: Provider) => {
    formGenerationRef.current += 1;
    setDraft(toFormDraft(provider));
    setEditingId(provider.id);
    setFormTestResult(null);
    setFormTesting(false);
  };

  const runFormTest = async () => {
    const generation = formGenerationRef.current;
    setFormTesting(true);
    setFormTestResult(null);
    try {
      const result = await testProviderDraft(toPayload(draft));
      if (formGenerationRef.current === generation) setFormTestResult(formatTestResult(result));
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
  const isGemini = draft.transport === "gemini";
  const usesBaseUrl = isGemini || draft.transport === "openai-compatible";

  return (
    <div className="llm-tab-body" data-testid="llm-providers-section">
      <div className="llm-tab-head">
        <p className="llm-tab-hint">
          A connection to a command-line tool or to an API endpoint, local or hosted.
        </p>
        <button
          type="button"
          className="llm-button-primary"
          data-testid="llm-provider-add"
          disabled={editingId !== null}
          onClick={startCreate}
        >
          + Add provider
        </button>
      </div>

      {error && (
        <p className="llm-status-fail" aria-live="polite">
          {error}
        </p>
      )}

      {providers !== null && rows.length === 0 && editingId === null && (
        <div className="llm-empty">
          <p>No providers yet.</p>
          <p className="llm-empty-hint">
            Add one to route a feature at it. Until then every feature keeps its current default.
          </p>
        </div>
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
                    <span className="llm-provider-sub">{subtitleOf(provider)}</span>
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
          <h3 className="llm-card-title">
            {editingId === "new" ? "Add provider" : "Edit provider"}
          </h3>

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

            {draft.kind === "cli" ? (
              <>
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
                {draft.adapter === "claude" && (
                  <>
                    <label className="llm-field">
                      <span className="llm-field-label">Base URL (optional)</span>
                      <input
                        data-testid="llm-provider-cli-base-url"
                        placeholder="https://your-proxy.example.com"
                        value={draft.baseUrl}
                        onChange={(e) => set("baseUrl", e.target.value)}
                      />
                    </label>
                    <label className="llm-field">
                      <span className="llm-field-label">API key (optional)</span>
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
                      Only used by the claude adapter, to point it at a proxy instead of the
                      default Anthropic API. The endpoint must speak the Anthropic Messages API
                      — not an OpenAI-compatible one like a "Direct API" provider's endpoint.
                    </p>
                    <div className="llm-field">
                      <span className="llm-field-label">TLS</span>
                      <label className="llm-check">
                        <input
                          type="checkbox"
                          data-testid="llm-provider-cli-verify-ssl"
                          checked={draft.skipTls}
                          onChange={(e) => set("skipTls", e.target.checked)}
                        />
                        <span>Skip certificate verification (self-signed / private CA)</span>
                      </label>
                      {draft.skipTls && (
                        <p
                          className="llm-status-fail"
                          data-testid="llm-provider-cli-verify-ssl-warning"
                          aria-live="polite"
                        >
                          Insecure: the connection is not protected against a
                          man-in-the-middle. Only use this for a trusted internal host.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
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
                    <div className="llm-field">
                      <span className="llm-field-label">TLS</span>
                      <label className="llm-check">
                        <input
                          type="checkbox"
                          data-testid="llm-provider-verify-ssl"
                          checked={draft.skipTls}
                          onChange={(e) => set("skipTls", e.target.checked)}
                        />
                        <span>Skip certificate verification (self-signed / private CA)</span>
                      </label>
                      {draft.skipTls && (
                        <p
                          className="llm-status-fail"
                          data-testid="llm-provider-verify-ssl-warning"
                          aria-live="polite"
                        >
                          Insecure: the connection is not protected against a
                          man-in-the-middle. Only use this for a trusted internal host.
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div className="llm-field">
                  <span className="llm-field-label">Credentials</span>
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
                    <input
                      type="password"
                      data-testid="llm-provider-api-key"
                      aria-label="API key"
                      placeholder={draft.hadKey ? "Unchanged (leave blank to keep)" : "API key — sk-…"}
                      value={draft.apiKey}
                      onChange={(e) => set("apiKey", e.target.value)}
                    />
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

          <div className="llm-card-footer">
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
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
