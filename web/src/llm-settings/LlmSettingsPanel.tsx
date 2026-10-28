import { useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { PanelCloseButton } from "../canvas/PanelCloseButton";
import { AgentInstructionSection } from "./AgentInstructionSection";
import { ConnectionsTab } from "./ConnectionsTab";
import { ModelsTab } from "./ModelsTab";
import { RuntimeSection } from "./RuntimeSection";
import "./LlmSettings.css";

type Tab = "models" | "connections" | "advanced";

const TABS: { id: Tab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "connections", label: "Connections" },
  { id: "advanced", label: "Advanced" },
];

/** Every AI setting in one window: one default model, the connections behind it, and rarely-needed paths. */
export function LlmSettingsPanel({ onDismiss }: { onDismiss: () => void }) {
  const [view, setView] = useState<Tab | "add-connection">("models");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const tab: Tab = view === "add-connection" ? "connections" : view;

  return (
    <ModalDialog
      label="LLM settings"
      testId="llm-settings-panel"
      className="llm-settings-panel"
      onDismiss={onDismiss}
    >
      <header className="llm-dialog-header">
        <div className="llm-dialog-title">
          <h2>AI models</h2>
          <p className="llm-subtle">
            Pick one model for everything. Change individual features only if you want to.
          </p>
        </div>
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
            onClick={() => setView(id)}
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
        {tab === "models" && <ModelsTab onAddConnection={() => setView("add-connection")} />}
        {tab === "connections" && <ConnectionsTab
            startAdding={view === "add-connection"}
            footerSlot={slot}
            onFormOpenChange={setFormOpen}
          />}
        {tab === "advanced" && (
          <div className="llm-tab-body" data-testid="llm-advanced-tab">
            <p className="llm-subtle">Rarely needed. Everything here has a working default.</p>
            <AgentInstructionSection />
            <RuntimeSection />
          </div>
        )}
      </div>

      <footer className="llm-dialog-footer">
        <div ref={setSlot} className="llm-footer-slot" hidden={!formOpen} />
        {!formOpen && (
          <>
            <span className="llm-subtle">Saved automatically · applies to this machine</span>
            <button
              type="button"
              className="llm-button-primary"
              data-testid="llm-settings-done"
              onClick={onDismiss}
            >
              Done
            </button>
          </>
        )}
      </footer>
    </ModalDialog>
  );
}
