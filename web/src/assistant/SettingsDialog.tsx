import { useEffect, useState } from "react";
import { UpdatesPanel } from "./UpdatesPanel";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { ModalDialog } from "../agents/ModalDialog";
import { RailIcon } from "../icons/RailIcon";
import { LlmSettingsPanel } from "../llm-settings/LlmSettingsPanel";
import { listCallSites, listProviders } from "../llm-settings/llmSettingsClient";

/** One line of live numbers under the LLM row, so the settings home says something before you open
 * it. Silently absent when there is no bridge to ask. */
function useLlmSummary(): string | null {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listProviders(), listCallSites()])
      .then(([providers, callSites]) => {
        // A group counts as every one of its member skills -- one Diagrams assignment routes them all.
        const total =
          callSites.simple.length +
          callSites.groups.reduce((sum, group) => sum + group.members.length, 0);
        const routed =
          callSites.simple.filter((site) => site.assignment).length +
          callSites.groups
            .filter((group) => group.assignment)
            .reduce((sum, group) => sum + group.members.length, 0);
        const providerWord = providers.length === 1 ? "provider" : "providers";
        setSummary(`${providers.length} ${providerWord} · ${routed} of ${total} features routed`);
      })
      .catch(() => setSummary(null));
  }, []);

  return summary;
}

/** The settings home: a list of categories, each opening its own dialog. Everything LLM-related --
 * provider connections, per-feature routing, and the agent-window fallback -- lives behind the one
 * "LLM" row rather than being split between here and a second rail button. */
export function SettingsDialog({ onDismiss }: { onDismiss: () => void }) {
  const [openCategory, setOpenCategory] = useState<"llm" | "updates" | "issue" | null>(null);
  const summary = useLlmSummary();

  // One modal at a time, never stacked: two live ModalDialogs both bind a capturing document
  // keydown listener, so Escape in the child would dismiss the parent too.
  if (openCategory === "updates") return <UpdatesPanel onDismiss={() => setOpenCategory(null)} />;
  if (openCategory === "llm") return <LlmSettingsPanel onDismiss={() => setOpenCategory(null)} />;
  if (openCategory === "issue") return <CreateIssueDialog onDismiss={() => setOpenCategory(null)} />;

  return (
    <ModalDialog
      label="Settings"
      testId="assistant-settings-dialog"
      className="settings-home-dialog"
      onDismiss={onDismiss}
    >
      <header className="llm-dialog-header">
        <h2>Settings</h2>
      </header>

      <ul className="settings-home-list">
        <li>
          <button
            type="button"
            className="settings-home-row"
            data-testid="settings-open-llm"
            onClick={() => setOpenCategory("llm")}
          >
            <span className="settings-home-row-icon">
              <RailIcon name="llm-providers" />
            </span>
            <span className="settings-home-row-text">
              <span className="settings-home-row-title">LLM</span>
              <span className="settings-home-row-desc">
                Provider connections, which model each feature uses, and agent-window credentials
              </span>
              {summary && (
                <span className="settings-home-row-summary" data-testid="settings-llm-summary">
                  {summary}
                </span>
              )}
            </span>
            <span className="settings-home-row-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
        <li><button type="button" className="settings-home-row" data-testid="settings-open-updates" onClick={() => setOpenCategory("updates")}>
          <span className="settings-home-row-text"><span className="settings-home-row-title">Updates</span><span className="settings-home-row-desc">Installed version, stable releases, and app updates</span></span>
          <span className="settings-home-row-chevron" aria-hidden="true">›</span>
        </button></li>
        <li><button type="button" className="settings-home-row" data-testid="settings-open-issue" onClick={() => setOpenCategory("issue")}>
          <span className="settings-home-row-icon">
            <RailIcon name="report-issue" />
          </span>
          <span className="settings-home-row-text"><span className="settings-home-row-title">Report an issue</span><span className="settings-home-row-desc">File a bug or suggest an idea on GitHub</span></span>
          <span className="settings-home-row-chevron" aria-hidden="true">›</span>
        </button></li>
      </ul>

      <div className="llm-dialog-actions">
        <button
          type="button"
          className="llm-button-primary"
          data-testid="assistant-dismiss"
          onClick={onDismiss}
        >
          Done
        </button>
      </div>
    </ModalDialog>
  );
}
