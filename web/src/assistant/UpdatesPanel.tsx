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

const STATUS: Record<UpdateState["phase"], string> = {
  idle: "Not checked",
  checking: "Checking for updates…",
  "up-to-date": "Up to date",
  available: "Update available",
  downloading: "Downloading update…",
  ready: "Ready to restart",
  installing: "Preparing update…",
  error: "Update failed",
};

export function UpdatesPanel({ onDismiss }: { onDismiss: () => void }) {
  const [state, setState] = useState<UpdateState>({ currentVersion: "Unknown", phase: "checking" });
  const [now, setNow] = useState(Date.now());
  const api = window.codechromaUpdates;
  const run = (action: () => Promise<UpdateState>) => {
    action().then(setState).catch(error => setState(s => ({
      ...s, phase: "error", error: `${String(error)} Check your connection and try again.`,
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
      if (active) setState(s => ({ ...s, phase: "error", error: String(error) }));
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (!state.retryAfter || state.phase !== "error") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.phase, state.retryAfter]);

  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  const rateLimited = state.retryAfter !== undefined && now < state.retryAfter;
  const retryLabel = state.retryAfter
    ? (() => {
      const seconds = Math.ceil((state.retryAfter! - now) / 1000);
      const minutes = Math.ceil(seconds / 60);
      return minutes > 0 ? `Try again in ${minutes} min` : `Try again in ${seconds} sec`;
    })()
    : "Try again";
  return (
    <ModalDialog label="Updates" testId="updates-panel" className="settings-home-dialog" onDismiss={onDismiss}>
      <header className="llm-dialog-header"><h2>Updates</h2></header>
      {!api ? (
        <p>Open CodeChroma in the desktop app to check and install updates.</p>
      ) : (
        <>
          <dl>
            <dt>Current version</dt><dd>{state.currentVersion}</dd>
            <dt>Latest stable version</dt><dd>{state.latestVersion ?? "Not checked"}</dd>
          </dl>
          <p role="status">{STATUS[state.phase]}</p>
          {state.phase === "downloading" && (
            <>
              <progress aria-label="Download progress" value={state.total ? state.bytes ?? 0 : undefined} max={state.total ?? 1} />
              <p>{((state.bytes ?? 0) / 1048576).toFixed(1)} MB downloaded</p>
            </>
          )}
          {state.phase === "installing" && <progress aria-label="Update progress" />}
          {state.error && <p role="alert">{state.error}</p>}
          {state.phase === "available" && (
            <button className="llm-button-primary" onClick={() => run(api.download)}>
              Update to {state.latestVersion}
            </button>
          )}
          {state.phase === "ready" && (
            <button className="llm-button-primary" onClick={() => run(api.restart)}>Restart and Update</button>
          )}
          <button disabled={busy || state.phase === "ready" || rateLimited} onClick={() => run(api.check)}>
            {state.phase === "error" ? retryLabel : "Check for updates"}
          </button>
          <p>
            <a href="https://github.com/gutzerk/code_chroma/releases" target="_blank" rel="noreferrer">GitHub Releases</a>
          </p>
        </>
      )}
      <div className="llm-dialog-actions"><button onClick={onDismiss}>Back</button></div>
    </ModalDialog>
  );
}
