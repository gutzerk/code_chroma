import { NEEDS_LABEL } from "./capability";
import type { Feature, FeatureSource, Provider } from "./llmSettingsClient";
import { ModelPills } from "./ModelPills";
import { Pill } from "./Pill";

const SOURCE_LABEL: Record<FeatureSource, string> = {
  default: "Default",
  custom: "Custom",
  fallback: "Fallback",
  offline: "Off",
  legacy: "Not set",
};

function valueOf(feature: Feature): string {
  const { provider_name: name, model } = feature.effective;
  if (feature.source === "offline") return "Offline · no AI";
  if (!name) return "Today's behavior";
  return model ? `${name} · ${model}` : name;
}

interface DetailProps {
  feature: Feature;
  providers: Provider[];
  models: string[];
  onToggle: () => void;
  onPickConnection: (providerId: string) => void;
  onPickModel: (model: string) => void;
  onPickOffline: () => void;
  onReset: () => void;
}

/** The expanded override editor: compatible connections, then that connection's models. */
function FeatureDetail({
  feature,
  providers,
  models,
  onToggle,
  onPickConnection,
  onPickModel,
  onPickOffline,
  onReset,
}: DetailProps) {
  const kind = NEEDS_LABEL[feature.needs].noun;
  const choices = providers.filter((p) => feature.compatible_provider_ids.includes(p.id));

  return (
    <div className="llm-feature-detail">
      <div className="llm-step">
        <span className="llm-subtle">Connection · only ones that can run {kind}s are shown</span>
        <div className="llm-pill-row">
          {choices.map((p) => (
            <Pill
              key={p.id}
              pressed={p.id === feature.effective.provider_id}
              onClick={() => onPickConnection(p.id)}
            >
              {p.label}
            </Pill>
          ))}
          {feature.needs === "quick" && (
            <Pill pressed={feature.source === "offline"} onClick={onPickOffline}>
              Offline · no AI
            </Pill>
          )}
          {choices.length === 0 && feature.needs !== "quick" && <span className="llm-subtle">No connection can run this yet.</span>}
        </div>
      </div>
      {feature.effective.provider_id && (
        <div className="llm-step">
          <span className="llm-subtle">Model</span>
          <ModelPills
            models={models}
            value={feature.effective.model ?? ""}
            onPick={onPickModel}
            testId={`llm-feature-models-${feature.id}`}
          />
        </div>
      )}
      <div className="llm-feature-actions">
        {(feature.source === "custom" || feature.source === "offline") && (
          <button
            type="button"
            className="llm-button-ghost"
            data-testid={`llm-feature-reset-${feature.id}`}
            onClick={onReset}
          >
            Use default again
          </button>
        )}
        <button type="button" className="llm-button-ghost" onClick={onToggle}>
          Done
        </button>
      </div>
    </div>
  );
}

/** One feature: a summary line that expands in place into a connection + model override. */
export function FeatureRow({ open, ...detail }: DetailProps & { open: boolean }) {
  const { feature, onToggle } = detail;

  return (
    <div className="llm-feature" data-testid={`llm-feature-${feature.id}`}>
      <button
        type="button"
        className="llm-feature-row"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`llm-feature-toggle-${feature.id}`}
      >
        <span className="llm-feature-text">
          <span className="llm-feature-name">{feature.label}</span>
          <span className="llm-subtle">{feature.description}</span>
        </span>
        <span className="llm-feature-kind">{NEEDS_LABEL[feature.needs].kind}</span>
        <span className="llm-feature-value">{valueOf(feature)}</span>
        <span
          className={`llm-source llm-source-${feature.source}`}
          data-testid={`llm-feature-source-${feature.id}`}
        >
          {SOURCE_LABEL[feature.source]}
        </span>
        <span className="llm-feature-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <FeatureDetail {...detail} />}
    </div>
  );
}
