import { useCallback, useEffect, useState } from "react";
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Settings › Integrations: connect or disconnect the one Slack workspace and one Outlook mailbox the unread panel reads. */
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
    return () => clearInterval(timer);
  }, [waitingForOutlook, reload]);

  useEffect(() => {
    if (waitingForOutlook && status?.outlook.connected) {
      setWaitingForOutlook(false);
      void messagesStore.load();
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
      setWaitingForOutlook(true);
    });

  const needsOwnClient = status ? !status.outlook.default_client_available : false;

  return (
    <ModalDialog label="Integrations" testId="integrations-dialog" className="integrations-dialog" onDismiss={onDismiss}>
      <header className="llm-dialog-header">
        <h2>Integrations</h2>
      </header>
      <p className="integrations-lead">
        Read-only: CodeChroma lists unread messages and opens them in Slack or Outlook. Only the sign-in tokens are saved; no
        message is written to disk.
      </p>
      {loadError && <p className="integrations-error" role="alert">{loadError}</p>}
      {status?.token_storage.warning && (
        <p className="integrations-warning" data-testid="integrations-storage-warning" role="note">
          {status.token_storage.warning}
        </p>
      )}

      <section className="integrations-section" aria-labelledby="integrations-slack">
        <h3 id="integrations-slack">Slack</h3>
        {status?.slack.connected ? (
          <div className="integrations-connected" data-testid="integrations-slack-connected">
            <span>
              Connected{status.slack.workspace ? ` to ${status.slack.workspace}` : ""}
              {status.slack.user ? ` as ${status.slack.user}` : ""}
            </span>
            {status.slack.error && <span className="integrations-error">{status.slack.error}</span>}
            <button type="button" disabled={busy !== null} onClick={() => run("slack", () => disconnectSource("slack"))}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <ol className="integrations-steps">
              <li>
                Create an app at api.slack.com/apps › <em>From a manifest</em> and paste the manifest below.
              </li>
              <li>Install it to your workspace and copy the User OAuth Token (xoxp-).</li>
              <li>Under Basic Information › App-Level Tokens, create one with connections:write (xapp-).</li>
            </ol>
            {manifest && (
              <details className="integrations-manifest">
                <summary>Slack app manifest</summary>
                <pre data-testid="integrations-slack-manifest">{manifest}</pre>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(manifest)}>
                  Copy manifest
                </button>
              </details>
            )}
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
              className="llm-button-primary"
              disabled={busy !== null || !userToken.trim() || !appToken.trim()}
              onClick={() => void onConnectSlack()}
            >
              {busy === "slack" ? "Connecting…" : "Connect Slack"}
            </button>
          </>
        )}
        {actionError.slack && <p className="integrations-error" role="alert">{actionError.slack}</p>}
      </section>

      <section className="integrations-section" aria-labelledby="integrations-outlook">
        <h3 id="integrations-outlook">Outlook</h3>
        {status?.outlook.connected ? (
          <div className="integrations-connected" data-testid="integrations-outlook-connected">
            <span>Connected{status.outlook.account ? ` as ${status.outlook.account}` : ""}</span>
            {status.outlook.error && <span className="integrations-error">{status.outlook.error}</span>}
            <button type="button" disabled={busy !== null} onClick={() => run("outlook", () => disconnectSource("outlook"))}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <p className="integrations-hint">
              Signs in with Microsoft in your browser (Mail.Read). If your organization requires admin consent, use an
              application (client) id your admin registered, with the redirect URI http://localhost.
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
              className="llm-button-primary"
              disabled={busy !== null || (needsOwnClient && !clientId.trim())}
              onClick={() => void onConnectOutlook()}
            >
              {waitingForOutlook ? "Waiting for sign-in…" : "Connect Outlook"}
            </button>
          </>
        )}
        {actionError.outlook && <p className="integrations-error" role="alert">{actionError.outlook}</p>}
      </section>

      <div className="llm-dialog-actions">
        <button type="button" className="llm-button-primary" onClick={onDismiss}>
          Done
        </button>
      </div>
    </ModalDialog>
  );
}
