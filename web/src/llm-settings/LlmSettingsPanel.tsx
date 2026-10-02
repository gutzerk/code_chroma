import { useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { AssistantSection } from "../assistant/AssistantSection";
import { PanelCloseButton } from "../canvas/PanelCloseButton";
import { CallSitesSection } from "./CallSitesSection";
import { ProvidersSection } from "./ProvidersSection";

type Tab = "providers" | "call-sites" | "assistant";

const TABS: { id: Tab; label: string }[] = [
  { id: "providers", label: "Providers" },
  { id: "call-sites", label: "Model routing" },
  { id: "assistant", label: "Agent windows" },
];

/** Every LLM setting in one window, reached from the single Settings gear -- provider connections,
 * the per-feature routing table, and the agent-window fallback credentials. */
export function LlmSettingsPanel({ onDismiss }: { onDismiss: () => void }) {
  const [tab, setTab] = useState<Tab>("providers");

  return (
    <ModalDialog
      label="LLM settings"
      testId="llm-settings-panel"
      className="llm-settings-panel"
      onDismiss={onDismiss}
    >
      <header className="llm-dialog-header">
        <h2>LLM</h2>
        <PanelCloseButton
          className="llm-dialog-close"
          ariaLabel="Close"
          testId="llm-settings-dismiss"
          onClick={onDismiss}
        />
      </header>

      <div className="llm-settings-tabs" role="tablist" aria-label="LLM settings sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`llm-settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`llm-settings-panel-${id}`}
            data-testid={`llm-settings-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        className="llm-settings-tabpanel"
        id={`llm-settings-panel-${tab}`}
        aria-labelledby={`llm-settings-tab-${tab}`}
      >
        {tab === "providers" && <ProvidersSection />}
        {tab === "call-sites" && <CallSitesSection />}
        {tab === "assistant" && <AssistantSection />}
      </div>
    </ModalDialog>
  );
}
