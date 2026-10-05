import { useEffect, useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";

export interface UpdateState {
  currentVersion: string;
  latestVersion?: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error";
  bytes?: number;
  total?: number;
  error?: string;
  retryAfter?: number;
}

export interface UpdatesApi {
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  restart(): Promise<UpdateState>;
  subscribe(handler: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window { codechromaUpdates?: UpdatesApi }
}

function displayVersion(version: string | undefined): string {
  return version?.replace(/^v/i, "") ?? "Unknown";
}

export function UpdatesPanel({ onDismiss }: { onDismiss: () => void }) {
  const [state, setState] = useState<UpdateState>({ currentVersion: "Unknown", phase: "checking" });
  const api = window.codechromaUpdates;
  const run = (action: () => Promise<UpdateState>) => {
    action().then(setState).catch(error => setState(s => ({
      ...s,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
    })));
  };

  useEffect(() => {
    if (!api) return;
    let active = true;
    const unsubscribe = api.subscribe(s => { if (active) setState(s); });
    api.state().then(s => {
      if (!active) return;
      setState(s);
      if (s.phase === "idle") return api.check().then(s => { if (active) setState(s); });
    }).catch(error => {
      if (active) setState(s => ({
        ...s,
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  const checking = state.phase === "checking";
  const downloading = state.phase === "downloading";
  const installing = state.phase === "installing";
  const busy = checking || downloading || installing;
  const upToDate = state.phase === "up-to-date";
  const available = state.phase === "available";
  const ready = state.phase === "ready";
  const headline = available
    ? "Update available"
    : upToDate
      ? "You're up to date"
      : checking
        ? "Checking for updates…"
        : state.phase === "error"
          ? "Update check failed"
          : "Updates";

  return (
    <ModalDialog label="Updates" testId="updates-panel" className="updates-dialog" onDismiss={onDismiss}>
      <header className="updates-header">
        <button
          className="updates-back"
          type="button"
          aria-label="Back"
          onClick={onDismiss}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h2>Updates</h2>
      </header>

      {!api ? (
        <p className="updates-message">Open CodeChroma in the desktop app to check and install updates.</p>
      ) : (
        <>
          <section className="updates-status" aria-live="polite">
            <h3>{headline}</h3>
            {available && (
              <p>A new stable version of Code Chroma is ready to install.</p>
            )}
          </section>

          <section className={`updates-version-card${upToDate ? " updates-version-current-only" : ""}`} aria-label="Version information">
            <div className="updates-version">
              <span>Current</span>
              <strong>{displayVersion(state.currentVersion)}</strong>
            </div>
            {available && (
              <>
                <svg className="updates-version-arrow" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
                <div className="updates-version updates-version-latest">
                  <span>Latest stable</span>
                  <strong>{displayVersion(state.latestVersion)}</strong>
                </div>
              </>
            )}
          </section>

          {state.phase === "error" && (
            <p className="updates-error" role="alert">
              {state.error || "Couldn't check for updates. Try again."}
            </p>
          )}

          <div className="updates-actions">
            {available && (
              <button
                className="updates-primary"
                type="button"
                disabled={busy}
                onClick={() => run(api.download)}
              >
                Update now
              </button>
            )}
            {downloading && (
              <div className="updates-download" aria-live="polite">
                <span>Downloading…</span>
                <progress
                  aria-label="Download progress"
                  value={state.total ? state.bytes ?? 0 : undefined}
                  max={state.total ?? 1}
                />
              </div>
            )}
            {ready && (
              <button
                className="updates-primary"
                type="button"
                onClick={() => run(api.restart)}
              >
                Restart to finish updating
              </button>
            )}
            {installing && (
              <div className="updates-download" aria-live="polite">
                <span>Restarting…</span>
                <progress aria-label="Installing update" />
              </div>
            )}

            <div className="updates-secondary-actions">
              <button
                className="updates-check"
                type="button"
                disabled={busy}
                onClick={() => run(api.check)}
              >
                {checking ? "Checking…" : "Check for updates"}
              </button>
              <a
                className="updates-release-link"
                href="https://github.com/gutzerk/code_chroma/releases"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Release notes on GitHub</span>
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M9 2h5v5M14 2 7 9M12 9v4H3V4h4" />
                </svg>
              </a>
            </div>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
