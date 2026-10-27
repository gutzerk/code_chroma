import { useEffect, useState } from "react";
import { capabilityText, connectionSubtitle } from "./capability";
import { fetchCliStatus, type DefaultAssignment, type DefaultFallback, type Provider } from "./llmSettingsClient";
import { ModelPills } from "./ModelPills";
import { Pill } from "./Pill";

export type FallbackKind = "quick" | "agent";

const OFFLINE = "offline";

/** The provider id a fallback points at, `offline`, or null -- the pill that reads as pressed. */
function choiceOf(fb: DefaultFallback | null | undefined): string | null {
  if (!fb) return null;
  return "offline" in fb ? OFFLINE : fb.provider_id;
}

function fallbackLabel(fb: DefaultFallback | null | undefined, providers: Provider[]): string | null {
  if (!fb) return null;
  if ("offline" in fb) return "Offline · no AI";
  const label = providers.find((p) => p.id === fb.provider_id)?.label ?? fb.provider_id;
  return fb.model ? `${label} · ${fb.model}` : label;
}

/** "X can't do Y, use this instead" with one pill per connection that can (and Offline for quick tasks). */
function FallbackPicker({
  testId,
  message,
  current,
  currentLabel,
  choices,
  allowOffline,
  labelOf,
  onPick,
}: {
  testId: string;
  message: string;
  current: string | null;
  currentLabel: string | null;
  choices: Provider[];
  allowOffline: boolean;
  labelOf: (provider: Provider) => string;
  onPick: (choice: string) => void;
}) {
  return (
    <div className="llm-fallback" data-testid={testId}>
      <p>
        {message}
        {currentLabel && <strong> {currentLabel}</strong>}
      </p>
      <div className="llm-pill-row">
        {choices.map((p) => (
          <Pill key={p.id} pressed={current === p.id} onClick={() => onPick(p.id)}>
            {labelOf(p)}
          </Pill>
        ))}
        {allowOffline && (
          <Pill pressed={current === OFFLINE} onClick={() => onPick(OFFLINE)}>
            Offline · no AI
          </Pill>
        )}
      </div>
    </div>
  );
}

/** The "Default for every feature" card: pick a connection, then a model; fallbacks appear only when needed. */
export function DefaultCard({
  providers,
  def,
  selectedId,
  modelsOf,
  load,
  headline,
  onPickConnection,
  onPickModel,
  onPickFallback,
  onAddConnection,
}: {
  providers: Provider[];
  def: DefaultAssignment | null;
  selectedId: string | null;
  modelsOf: (providerId: string | null | undefined) => string[];
  load: (providerId: string) => Promise<string[]>;
  headline: string;
  onPickConnection: (providerId: string) => void;
  onPickModel: (model: string) => void;
  onPickFallback: (kind: FallbackKind, choice: string) => void;
  onAddConnection: () => void;
}) {
  const [signedIn, setSignedIn] = useState<{ id: string; ok: boolean } | null>(null);
  const selected = providers.find((p) => p.id === selectedId) ?? null;
  const caps = selected?.capabilities;
  const quickChoices = def && caps && !caps.quick ? providers.filter((p) => p.capabilities?.quick) : [];
  const agentChoices = def && caps && !caps.agents ? providers.filter((p) => p.capabilities?.agents) : [];
  const fallbackIds = [...quickChoices, ...agentChoices].map((p) => p.id).join(",");
  useEffect(() => {
    for (const id of fallbackIds.split(",")) if (id) void load(id);
  }, [fallbackIds, load]);
  const choiceLabel = (p: Provider) => {
    const model = modelsOf(p.id)[0];
    return model ? `${p.label} · ${model}` : p.label;
  };

  const cliAdapter = selected?.kind === "cli" ? selected.adapter : null;
  useEffect(() => {
    if (!selectedId || !cliAdapter) return;
    let stale = false;
    fetchCliStatus(cliAdapter)
      .then((r) => !stale && setSignedIn({ id: selectedId, ok: r?.signed_in === true }))
      .catch(() => !stale && setSignedIn(null));
    return () => {
      stale = true;
    };
  }, [selectedId, cliAdapter]);
  const status = !selected
    ? null
    : selected.kind === "cli"
      ? signedIn?.id === selected.id && signedIn.ok
        ? "Signed in"
        : null
      : selected.is_local
        ? "Local"
        : selected.api_key_set
          ? "Key set"
          : null;

  return (
    <section className="llm-default-card" data-testid="llm-default-card" aria-label="Default model">
      <div className="llm-default-head">
        <div>
        <h3 className="llm-card-title">Default for every feature</h3>
        <p className="llm-subtle" data-testid="llm-default-headline">
          {headline}
        </p>
        </div>
        {status && (
          <span className="llm-source llm-source-default" data-testid="llm-default-status">
            {status}
          </span>
        )}
      </div>

      <div className="llm-step">
        <span className="llm-step-label">1 · Connection</span>
        {providers.length === 0 ? (
          <p className="llm-subtle" data-testid="llm-default-empty">
            No connections yet. Add one to choose a model.
          </p>
        ) : (
          <div className="llm-chip-grid">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="llm-chip"
                aria-pressed={provider.id === selectedId}
                data-testid={`llm-default-conn-${provider.id}`}
                onClick={() => onPickConnection(provider.id)}
              >
                <span className="llm-chip-name">{provider.label}</span>
                <span className="llm-chip-sub">{connectionSubtitle(provider)}</span>
                <span className="llm-chip-cap">{capabilityText(provider.capabilities)}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="llm-link-button" onClick={onAddConnection}>
          + Add a connection
        </button>
      </div>

      {selected && (
        <div className="llm-step">
          <span className="llm-step-label">2 · Model</span>
          <ModelPills
            models={modelsOf(selected.id)}
            value={def?.provider_id === selected.id ? def.model : ""}
            onPick={onPickModel}
            testId="llm-default-models"
          />
        </div>
      )}

      {quickChoices.length > 0 && (
        <FallbackPicker
          testId="llm-quick-fallback"
          message={`${selected?.label} can't run quick one-shot tasks (code summaries, first patterns draft). Use this for them instead:`}
          current={choiceOf(def?.quick_fallback)}
          currentLabel={fallbackLabel(def?.quick_fallback, providers)}
          choices={quickChoices}
          labelOf={choiceLabel}
          allowOffline
          onPick={(choice) => onPickFallback("quick", choice)}
        />
      )}

      {agentChoices.length > 0 && (
        <FallbackPicker
          testId="llm-agent-fallback"
          message={`${selected?.label} can't drive agents (diagrams, planning, agent windows). Agents need a CLI connection. Use this for them instead:`}
          current={choiceOf(def?.agent_fallback)}
          currentLabel={fallbackLabel(def?.agent_fallback, providers)}
          choices={agentChoices}
          labelOf={choiceLabel}
          allowOffline={false}
          onPick={(choice) => onPickFallback("agent", choice)}
        />
      )}
    </section>
  );
}
