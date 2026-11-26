import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import {
  connectOutlook,
  connectSlack,
  disconnectSource,
  getIntegrations,
  getSlackManifest,
  type Integrations,
  type MessageSourceName,
} from "./messagesClient";
import { messagesStore } from "./messagesStore";
import "./messages.css";

const OUTLOOK_POLL_MS = 2000;
/** How long Settings waits for the browser sign-in before giving up on it. */
export const OUTLOOK_WAIT_MS = 5 * 60 * 1000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Settings › Integrations (the messages rail button deep-links here while nothing is connected): connect or disconnect the one Slack workspace and one Outlook mailbox the unread panel reads. */
export function IntegrationsPanel({ onDismiss }: { onDismiss: () => void }) {
  const [status, setStatus] = useState<Integrations | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<string | null>(null);
  const [userToken, setUserToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [tenant, setTenant] = useState("");
  const [busy, setBusy] = useState<MessageSourceName | null>(null);
  const [actionError, setActionError] = useState<Partial<Record<MessageSourceName, string>>>({});
  const [waitingForOutlook, setWaitingForOutlook] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await getIntegrations());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    getSlackManifest()
      .then((value) => setManifest(JSON.stringify(value, null, 2)))
      .catch(() => setManifest(null));
  }, [reload]);

  useEffect(() => {
    if (!waitingForOutlook) return;
    const timer = setInterval(() => void reload(), OUTLOOK_POLL_MS);
    const giveUp = setTimeout(() => {
      setWaitingForOutlook(false);
      setActionError((current) => ({ ...current, outlook: "The Microsoft sign-in did not finish; try Connect Outlook again." }));
    }, OUTLOOK_WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [waitingForOutlook, reload]);

  useEffect(() => {
    if (!waitingForOutlook) return;
    if (status?.outlook.connected) {
      setWaitingForOutlook(false);
      void messagesStore.load();
    } else if (status?.outlook.state === "error") {
      setWaitingForOutlook(false);
      setActionError((current) => ({ ...current, outlook: status.outlook.error ?? "Outlook was not connected." }));
    }
  }, [waitingForOutlook, status]);

  const run = async (source: MessageSourceName, action: () => Promise<unknown>) => {
    setBusy(source);
    setActionError((current) => ({ ...current, [source]: undefined }));
    try {
      await action();
      await reload();
      void messagesStore.load();
    } catch (err) {
      setActionError((current) => ({ ...current, [source]: errorText(err) }));
    } finally {
      setBusy(null);
    }
  };

  const onConnectSlack = () =>
    run("slack", async () => {
      await connectSlack(userToken, appToken);
      setUserToken("");
      setAppToken("");
    });

  const onConnectOutlook = () =>
    run("outlook", async () => {
      const { auth_url } = await connectOutlook(clientId.trim(), tenant.trim());
      window.open(auth_url, "_blank", "noopener");
      await reload();
      setWaitingForOutlook(true);
    });

  const needsOwnClient = status ? !status.outlook.default_client_available : false;
  const noneConnected = status !== null && !status.slack.connected && !status.outlook.connected;

  const copyManifest = () => {
    if (!manifest) return;
    navigator.clipboard
      ?.writeText(manifest)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <ModalDialog
      label="Integrations"
      testId="integrations-dialog"
      className="canvas-style-dialog integrations-dialog"
      onDismiss={onDismiss}
    >
      <header className="llm-dialog-header">
        <button type="button" className="canvas-style-back" aria-label="Back" onClick={onDismiss}>
          ‹
        </button>
        <h2>Integrations</h2>
      </header>
      <p className="canvas-style-lede">
        Read-only: unread Slack and Outlook messages are listed here and open in their own app. Only sign-in tokens are
        saved, never messages.
      </p>
      {noneConnected && (
        <p className="integrations-empty" role="status" data-testid="integrations-none-connected">
          No messenger is connected yet. Connect Slack or Outlook below to see unread messages.
        </p>
      )}
      {loadError && <p className="integrations-error" role="alert">{loadError}</p>}

      <div className="integrations-grid">
        <SourceCard
          source="slack"
          label="Slack"
          connected={!!status?.slack.connected}
          summary={`Connected${status?.slack.workspace ? ` to ${status.slack.workspace}` : ""}${status?.slack.user ? ` as ${status.slack.user}` : ""}`}
          error={status?.slack.error ?? null}
          actionError={actionError.slack}
          busy={busy !== null}
          onDisconnect={() => run("slack", () => disconnectSource("slack"))}
        >
          <ol className="integrations-steps">
            <li>
              At api.slack.com/apps create an app <em>From a manifest</em> and paste the manifest.
              {manifest && (
                <button type="button" className="integrations-link" onClick={copyManifest}>
                  {copied ? "Copied" : "Copy manifest"}
                </button>
              )}
            </li>
            <li>Install it and copy the User OAuth Token (xoxp-).</li>
            <li>Basic Information › App-Level Tokens: create one with connections:write (xapp-).</li>
          </ol>
          <label className="integrations-field">
            User token
            <input type="password" autoComplete="off" placeholder="xoxp-…" value={userToken} onChange={(e) => setUserToken(e.target.value)} />
          </label>
          <label className="integrations-field">
            App-level token
            <input type="password" autoComplete="off" placeholder="xapp-…" value={appToken} onChange={(e) => setAppToken(e.target.value)} />
          </label>
          <button
            type="button"
            className="llm-button-primary integrations-connect"
            disabled={busy !== null || !userToken.trim() || !appToken.trim()}
            onClick={() => void onConnectSlack()}
          >
            {busy === "slack" ? "Connecting…" : "Connect Slack"}
          </button>
        </SourceCard>

        <SourceCard
          source="outlook"
          label="Outlook"
          connected={!!status?.outlook.connected}
          summary={`Connected${status?.outlook.account ? ` as ${status.outlook.account}` : ""}`}
          error={status?.outlook.error ?? null}
          actionError={actionError.outlook}
          busy={busy !== null}
          onDisconnect={() => run("outlook", () => disconnectSource("outlook"))}
        >
          <p className="integrations-hint">
            Signs in with Microsoft in your browser (Mail.Read). If your organization requires admin consent, use a client
            id your admin registered with the redirect URI http://127.0.0.1.
          </p>
          <label className="integrations-field">
            {needsOwnClient ? "Application (client) id" : "Own client id (optional)"}
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>
          <label className="integrations-field">
            Tenant (optional)
            <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="common" />
          </label>
          <button
            type="button"
            className="llm-button-primary integrations-connect"
            disabled={busy !== null || (needsOwnClient && !clientId.trim())}
            onClick={() => void onConnectOutlook()}
          >
            {waitingForOutlook ? "Waiting for sign-in…" : "Connect Outlook"}
          </button>
        </SourceCard>
      </div>

      {status?.token_storage.warning && (
        <p className="canvas-style-warning integrations-warning" data-testid="integrations-storage-warning" role="note">
          {status.token_storage.warning}
        </p>
      )}

      <div className="integrations-footer">
        <button type="button" className="llm-button-primary" onClick={onDismiss}>
          Done
        </button>
      </div>
    </ModalDialog>
  );
}

const CHIP: Record<"connected" | "error" | "off", { status: string; text: string }> = {
  connected: { status: "done", text: "Connected" },
  error: { status: "error", text: "Error" },
  off: { status: "off", text: "Not connected" },
};

/** One source's card: header with its status chip, then either the connected summary or the setup form. */
function SourceCard({
  source,
  label,
  connected,
  summary,
  error,
  actionError,
  busy,
  onDisconnect,
  children,
}: {
  source: MessageSourceName;
  label: string;
  connected: boolean;
  summary: string;
  error: string | null;
  actionError?: string;
  busy: boolean;
  onDisconnect: () => void;
  children: ReactNode;
}) {
  const chip = CHIP[connected ? (error ? "error" : "connected") : "off"];
  return (
    <section className="integrations-card" aria-labelledby={`integrations-${source}`}>
      <div className="integrations-card-head">
        <h3 id={`integrations-${source}`}>{label}</h3>
        <span className="status-chip" data-status={chip.status}>{chip.text}</span>
      </div>
      {connected ? (
        <div className="integrations-connected" data-testid={`integrations-${source}-connected`}>
          <span>{summary}</span>
          {error && <span className="integrations-error">{error}</span>}
          <button type="button" className="llm-button-ghost llm-button-danger" disabled={busy} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        children
      )}
      {actionError && <p className="integrations-error" role="alert">{actionError}</p>}
    </section>
  );
}
