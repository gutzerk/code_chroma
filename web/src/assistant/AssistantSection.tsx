import { useEffect, useRef, useState } from "react";
import {
  assignCallSiteGroup,
  clearCallSiteGroup,
  fetchProviderModels,
  getCallSiteGroup,
  listProviders,
  type Provider,
  type ProviderModelsResult,
} from "../llm-settings/llmSettingsClient";

/** Draft of the provider+model this tab routes agent windows to (`agents` group). */
interface ProviderDraft {
  providerId: string;
  model: string;
}

const AGENTS_GROUP = "agents";

/** `modelCatalog` entry while a fetch is in flight -- distinct from a resolved result. */
type ModelCatalogEntry = ProviderModelsResult | { loading: true };

/** Which CLI provider this machine's agent windows launch through -- the "Agent windows" tab of
 * the LLM dialog. Empty = the platform's default `claude` CLI (FR-012). No-bridge mode shows a
 * read-only hint instead. */
export function AssistantSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [providerSavedDraft, setProviderSavedDraft] = useState<ProviderDraft | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [noBridge, setNoBridge] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelCatalogEntry>>({});
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    Promise.all([listProviders(), getCallSiteGroup(AGENTS_GROUP)])
      .then(([provs, group]) => {
        setProviders(provs);
        const draft = {
          providerId: group.assignment?.provider_id ?? "",
          model: group.assignment?.model ?? "",
        };
        setProviderDraft(draft);
        setProviderSavedDraft(draft);
      })
      .catch(() => setNoBridge(true));
  }, []);

  const cliProviders = providers.filter((p) => p.kind === "cli");
  const datalistId = (providerId: string) => `llm-assistant-models-${providerId || "none"}`;

  const isProviderDirty = () => {
    if (!providerDraft || !providerSavedDraft) return false;
    return (
      providerDraft.providerId !== providerSavedDraft.providerId ||
      providerDraft.model !== providerSavedDraft.model
    );
  };

  const applyProvider = async () => {
    if (!providerDraft) return;
    setProviderBusy(true);
    setProviderError(null);
    try {
      if (!providerDraft.providerId) {
        await clearCallSiteGroup(AGENTS_GROUP);
      } else {
        await assignCallSiteGroup(AGENTS_GROUP, {
          provider_id: providerDraft.providerId,
          model: providerDraft.model,
        });
      }
      setProviderSavedDraft({ ...providerDraft });
      setNoBridge(false);
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const loadModels = async (providerId: string) => {
    setModelCatalog((c) => ({ ...c, [providerId]: { loading: true } }));
    try {
      const result = await fetchProviderModels(providerId);
      setModelCatalog((c) => ({ ...c, [providerId]: result }));
    } catch (err) {
      setModelCatalog((c) => ({
        ...c,
        [providerId]: {
          supported: false,
          models: [],
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const modelCatalogStatus = (providerId: string): { text: string; isError: boolean } | null => {
    const entry = modelCatalog[providerId];
    if (!entry || "loading" in entry) return null;
    if (entry.supported) {
      return { text: `${entry.models.length} models`, isError: false };
    }
    return { text: entry.error || "This provider can't list models", isError: true };
  };

  if (noBridge) {
    return (
      <p className="assistant-nobridge">
        No bridge connected. Set <code>VITE_ENGINE_BRIDGE_URL</code> (e.g.{" "}
        <code>http://localhost:8000</code>) to configure the assistant from here.
      </p>
    );
  }

  return (
    <div className="llm-tab-body" data-testid="assistant-section">
      <p className="llm-tab-hint">
        Choose the CLI provider agent windows launch through. Leave empty to use the platform
        default.
      </p>

      <div className="llm-card" data-testid="assistant-provider-card">
        <div className="llm-card-title">Agent provider</div>
        <div className="llm-field-grid">
          <label className="llm-field">
            <span className="llm-field-label">Provider</span>
            <select
              aria-label="Agent provider"
              data-testid="assistant-provider"
              value={providerDraft?.providerId ?? ""}
              disabled={providerDraft === null}
              onChange={(e) =>
                setProviderDraft((d) =>
                  d ? { ...d, providerId: e.target.value, model: e.target.value ? d.model : "" } : d
                )
              }
            >
              <option value="">Default (claude)</option>
              {cliProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {providerDraft && (
              <span className="llm-tag llm-tag-quiet" data-testid="assistant-provider-state">
                {providerSavedDraft?.providerId ? "Routed" : "Default"}
              </span>
            )}
          </label>

          <label className="llm-field">
            <span className="llm-field-label">Model</span>
            <input
              aria-label="Agent model"
              data-testid="assistant-provider-model"
              placeholder="model"
              list={datalistId(providerDraft?.providerId ?? "")}
              disabled={!providerDraft?.providerId || providerDraft === null}
              value={providerDraft?.model ?? ""}
              onChange={(e) =>
                setProviderDraft((d) => (d ? { ...d, model: e.target.value } : d))
              }
            />
          </label>
        </div>

        <div className="llm-card-footer">
          <button
            type="button"
            className="llm-button-ghost"
            data-testid="assistant-provider-fetch-models"
            disabled={!providerDraft?.providerId || providerBusy}
            onClick={() => providerDraft?.providerId && void loadModels(providerDraft.providerId)}
          >
            Fetch models
          </button>
          {isProviderDirty() && (
            <button
              type="button"
              className="llm-button-primary"
              data-testid="assistant-provider-apply"
              disabled={providerBusy}
              onClick={() => void applyProvider()}
            >
              Apply
            </button>
          )}
          {providerSavedDraft?.providerId && (
            <button
              type="button"
              className="llm-button-ghost"
              data-testid="assistant-provider-reset"
              disabled={providerBusy}
              onClick={() => {
                setProviderDraft({ providerId: "", model: "" });
                void clearCallSiteGroup(AGENTS_GROUP).then(() =>
                  setProviderSavedDraft({ providerId: "", model: "" })
                );
              }}
            >
              Reset
            </button>
          )}
        </div>

        {providerSavedDraft?.providerId &&
          providerSavedDraft.providerId !== providerDraft?.providerId && (
            <p className="llm-status-ok">Saved — will apply to new agent windows.</p>
          )}
        {providerError && <p className="llm-status-fail">{providerError}</p>}
        {providerSavedDraft &&
          modelCatalogStatus(providerDraft?.providerId ?? "") &&
          (() => {
            const s = modelCatalogStatus(providerDraft?.providerId ?? "")!;
            return (
              <p className={s.isError ? "llm-status-fail" : "llm-status-ok"}>{s.text}</p>
            );
          })()}
      </div>

      {Object.entries(modelCatalog).map(([providerId, entry]) =>
        "loading" in entry ? null : (
          <datalist key={providerId} id={datalistId(providerId)}>
            {entry.models.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
        )
      )}
    </div>
  );
}
