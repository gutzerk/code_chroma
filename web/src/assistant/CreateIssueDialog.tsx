import { useEffect, useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
// `window.codechromaUpdates` is declared globally by UpdatesPanel.tsx.

type IssueLabel = "bug" | "enhancement" | "question" | "documentation";
type Phase = "idle" | "submitting" | "error" | "success";

const REPO = "gutzerk/code_chroma";
const LABELS: IssueLabel[] = ["bug", "enhancement", "question", "documentation"];
// Keeps the prefilled GitHub URL well under the ~8k limit browsers and GitHub both tolerate.
const MAX_URL_LENGTH = 8000;

/** `navigator.platform` values are stable, OS-only strings (no hostname/username/paths) -- mapped
 * to a friendly label, falling back to the raw value for anything unrecognized. */
function osLabel(): string {
  const platform = navigator.platform || navigator.userAgent || "unknown platform";
  if (/^Win/i.test(platform)) return `Windows (${platform})`;
  if (/^Mac/i.test(platform)) return `macOS (${platform})`;
  if (/^Linux/i.test(platform)) return `Linux (${platform})`;
  return platform;
}

/** Reads the installed app version from the desktop updater bridge; resolves to `null` outside the
 * desktop app (e.g. the plain web canvas), where there is no packaged version to report. */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const api = window.codechromaUpdates;
    if (!api) return;
    let active = true;
    api.state().then(state => { if (active) setVersion(state.currentVersion); }).catch(() => {});
    return () => { active = false; };
  }, []);

  return version;
}

function systemInfoLine(appVersion: string | null): string {
  return `App: CodeChroma ${appVersion ?? "unknown"}\nOS: ${osLabel()}`;
}

function buildBody(description: string, includeSystemInfo: boolean, appVersion: string | null): string {
  const trimmed = description.trim();
  if (!includeSystemInfo) return trimmed;
  return `${trimmed}${trimmed ? "\n\n" : ""}---\n${systemInfoLine(appVersion)}`;
}

function buildIssueUrl(title: string, body: string, label: IssueLabel): string {
  const url = (t: string, b: string) =>
    `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title: t, body: b, labels: label }).toString()}`;
  const full = url(title, body);
  if (full.length <= MAX_URL_LENGTH) return full;
  // Truncate the body only -- the title and label are small and load-bearing for the issue form.
  const overflow = full.length - MAX_URL_LENGTH + "\n\n…(truncated)".length;
  const truncatedBody = `${body.slice(0, Math.max(0, body.length - overflow))}\n\n…(truncated)`;
  return url(title, truncatedBody);
}

/** The "Create issue" dialog: fills in `github.com/gutzerk/code_chroma/issues/new` and opens it in
 * the system browser (or a new tab, outside the desktop app) rather than posting via the API --
 * keeps the dialog token-free (issue #88's "Option A"). */
export function CreateIssueDialog({ onDismiss }: { onDismiss: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState<IssueLabel>("bug");
  const [includeSystemInfo, setIncludeSystemInfo] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const appVersion = useAppVersion();

  const hasContent = title.trim() !== "" || description.trim() !== "";

  function requestClose() {
    if (hasContent && phase !== "success") {
      setConfirmingDiscard(true);
      return;
    }
    onDismiss();
  }

  function handleSubmit() {
    if (!title.trim() || phase === "submitting") return;
    setPhase("submitting");
    setError(null);
    try {
      const body = buildBody(description, includeSystemInfo, appVersion);
      const url = buildIssueUrl(title.trim(), body, label);
      window.open(url, "_blank", "noopener,noreferrer");
      setPhase("success");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (confirmingDiscard) {
    return (
      <ModalDialog
        label="Discard issue?"
        testId="create-issue-dialog"
        className="issue-dialog issue-confirm-dialog"
        onDismiss={() => setConfirmingDiscard(false)}
      >
        <h3 className="issue-confirm-title">Discard this issue?</h3>
        <p className="issue-confirm-body">Your title and description will be lost.</p>
        <div className="issue-confirm-actions">
          <button
            type="button"
            className="issue-button-secondary"
            onClick={() => setConfirmingDiscard(false)}
          >
            Keep editing
          </button>
          <button type="button" className="issue-button-danger" onClick={onDismiss}>
            Discard
          </button>
        </div>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog label="Create issue" testId="create-issue-dialog" className="issue-dialog" onDismiss={requestClose}>
      <header className="issue-header">
        <button className="issue-back" type="button" aria-label="Back" onClick={requestClose}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h2>Create issue</h2>
      </header>

      <div className="issue-field">
        <label htmlFor="issue-title-input">Title</label>
        <input
          id="issue-title-input"
          type="text"
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Short summary of the problem or idea"
        />
      </div>

      <div className="issue-field">
        <label htmlFor="issue-description-input">Description</label>
        <textarea
          id="issue-description-input"
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="What happened? Steps to reproduce and what you expected. Markdown is supported."
        />
      </div>

      <div className="issue-field">
        <span className="issue-field-group-label">Label</span>
        <div className="issue-label-group" role="group" aria-label="Label">
          {LABELS.map(candidate => (
            <button
              key={candidate}
              type="button"
              className="issue-label-pill"
              aria-pressed={label === candidate}
              onClick={() => setLabel(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>

      <label className="issue-checkbox-row">
        <input
          type="checkbox"
          checked={includeSystemInfo}
          onChange={event => setIncludeSystemInfo(event.target.checked)}
        />
        Attach app version and system info
      </label>

      {phase === "error" && (
        <p className="issue-error" role="alert">
          {error || "Couldn't open the browser. Try again."}
        </p>
      )}

      <div className="issue-footer">
        <div className="issue-footer-buttons">
          <button type="button" className="issue-button-secondary" onClick={requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className="issue-button-primary"
            disabled={!title.trim() || phase === "submitting"}
            onClick={handleSubmit}
          >
            {phase === "submitting" ? "Creating…" : "Create issue"}
          </button>
        </div>
        <p className="issue-footer-note" aria-live="polite">
          {phase === "success"
            ? "Opened in your browser -- finish posting it there."
            : <>Will be posted to <span className="issue-footer-repo">{REPO}</span> on GitHub</>}
        </p>
      </div>
    </ModalDialog>
  );
}
