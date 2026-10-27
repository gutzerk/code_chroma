import { useCallback, useEffect, useState } from "react";
import { messageOf } from "../util/reportError";
import { DefaultCard, type FallbackKind } from "./DefaultCard";
import { FeatureRow } from "./FeatureRow";
import {
  deleteFeature,
  getDefault,
  listFeatures,
  listProviders,
  putDefault,
  putFeature,
  type DefaultAssignment,
  type DefaultFallback,
  type Feature,
  type Provider,
} from "./llmSettingsClient";
import { useProviderModels } from "./useProviderModels";

function headlineOf(def: DefaultAssignment | null, provider: Provider | null, features: Feature[]) {
  if (!def || !provider) return "Pick a connection and a model to use for everything.";
  const label = `${provider.label} · ${def.model}`;
  const onDefault = features.filter((f) => f.source === "default").length;
  if (onDefault === features.length) return `All ${features.length} features use ${label}.`;
  return `${onDefault} of ${features.length} features use ${label} · ${
    features.length - onDefault
  } set separately below.`;
}

/** Models tab: one default connection + model for everything, then five feature rows to override. */
export function ModelsTab({ onAddConnection }: { onAddConnection: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [def, setDef] = useState<DefaultAssignment | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [pendingConn, setPendingConn] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { load, modelsOf } = useProviderModels();

  const refreshFeatures = useCallback(
    () => listFeatures().then((rows) => setFeatures(rows.features)),
    []
  );

  useEffect(() => {
    Promise.all([listProviders(), getDefault(), listFeatures()])
      .then(([provs, current, rows]) => {
        setProviders(provs);
        setDef(current.default);
        setFeatures(rows.features);
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  const selectedId = pendingConn ?? def?.provider_id ?? null;
  const openProviderId = features.find((f) => f.id === openId)?.effective.provider_id ?? null;

  useEffect(() => {
    for (const id of [selectedId, openProviderId]) if (id) void load(id);
  }, [selectedId, openProviderId, load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refreshFeatures();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const saveDefault = (providerId: string, model: string, patch: Partial<DefaultAssignment> = {}) =>
    run(async () => {
      const saved = await putDefault({
        provider_id: providerId,
        model,
        quick_fallback: def?.quick_fallback ?? null,
        agent_fallback: def?.agent_fallback ?? null,
        ...patch,
      });
      setDef(saved.default);
      setPendingConn(null);
    });

  const pickDefaultConnection = async (providerId: string) => {
    setPendingConn(providerId);
    await saveDefault(providerId, "");
  };

  const pickFallback = async (kind: FallbackKind, choice: string) => {
    if (!def) return;
    let fallback: DefaultFallback = { offline: true };
    if (choice !== "offline") fallback = { provider_id: choice, model: "" };
    await saveDefault(def.provider_id, def.model, {
      [kind === "quick" ? "quick_fallback" : "agent_fallback"]: fallback,
    });
  };

  const overrideFeature = (feature: Feature, providerId: string, model: string) =>
    run(() => putFeature(feature.id, { provider_id: providerId, model }));

  const pickFeatureConnection = (feature: Feature, providerId: string) =>
    overrideFeature(feature, providerId, "");

  const custom = features.filter((f) => f.source === "custom");
  const defaultProvider = providers.find((p) => p.id === def?.provider_id) ?? null;

  return (
    <div className="llm-tab-body" data-testid="llm-models-tab">
      {error && (
        <p className="llm-status-fail" aria-live="polite">
          {error}
        </p>
      )}

      <DefaultCard
        providers={providers}
        def={def}
        selectedId={selectedId}
        modelsOf={modelsOf}
        load={load}
        headline={headlineOf(def, defaultProvider, features)}
        onPickConnection={(id) => void pickDefaultConnection(id)}
        onPickModel={(model) => selectedId && void saveDefault(selectedId, model)}
        onPickFallback={(kind, choice) => void pickFallback(kind, choice)}
        onAddConnection={onAddConnection}
      />

      <div className="llm-features">
        <div className="llm-features-head">
          <h3 className="llm-card-title">Per feature</h3>
          {custom.length > 0 && (
            <button
              type="button"
              className="llm-button-ghost"
              data-testid="llm-reset-all"
              onClick={() => void run(() => Promise.all(custom.map((f) => deleteFeature(f.id))))}
            >
              Reset all to default
            </button>
          )}
        </div>
        <p className="llm-subtle">
          Every feature follows the default. Click one to give it its own connection or model.
        </p>
        <div className="llm-feature-list">
          {features.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              providers={providers}
              open={openId === feature.id}
              models={modelsOf(feature.effective.provider_id)}
              onToggle={() => setOpenId(openId === feature.id ? null : feature.id)}
              onPickConnection={(id) => void pickFeatureConnection(feature, id)}
              onPickOffline={() => void run(() => putFeature(feature.id, { offline: true }))}
              onPickModel={(model) =>
                feature.effective.provider_id &&
                void overrideFeature(feature, feature.effective.provider_id, model)
              }
              onReset={() => void run(() => deleteFeature(feature.id))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
