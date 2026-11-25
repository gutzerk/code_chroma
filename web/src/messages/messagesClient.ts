import { bridgeRequest, jsonInit } from "../util/httpJson";

export type MessageSourceName = "slack" | "outlook";
export type SourceState = "connected" | "disconnected" | "error";

export interface SourceStatus {
  state: SourceState;
  error: string | null;
  synced_at: string | null;
}

/** One unread message; `id` is in-memory on the bridge (React key and dedupe only). */
export interface UnreadItem {
  id: string;
  source: MessageSourceName;
  where: string;
  from: string;
  preview: string;
  at: string;
  /** `slack://` deep link or Outlook's `webLink`. */
  open_url: string;
  /** Slack's web permalink, the fallback when the desktop app is not installed. */
  web_url: string | null;
}

export interface UnreadFeed {
  sources: Record<MessageSourceName, SourceStatus>;
  items: UnreadItem[];
}

export interface Integrations {
  slack: { connected: boolean; state: SourceState; error: string | null; workspace: string | null; user: string | null };
  outlook: {
    connected: boolean;
    state: SourceState;
    error: string | null;
    account: string | null;
    client_id: string | null;
    tenant: string;
    default_client_available: boolean;
  };
  token_storage: { backend: string; warning: string | null };
}

export function getUnread(): Promise<UnreadFeed> {
  return bridgeRequest<UnreadFeed>("/messages/unread");
}

/** Asks the bridge for a full re-check (window focus); throttled server-side. */
export function refreshMessages(): Promise<{ started: boolean }> {
  return bridgeRequest<{ started: boolean }>("/messages/refresh", jsonInit("POST"));
}

export function getIntegrations(): Promise<Integrations> {
  return bridgeRequest<Integrations>("/integrations");
}

export function getSlackManifest(): Promise<unknown> {
  return bridgeRequest<unknown>("/integrations/slack/manifest");
}

export function connectSlack(userToken: string, appToken: string): Promise<{ workspace: string; user: string }> {
  return bridgeRequest("/integrations/slack", jsonInit("POST", { user_token: userToken, app_token: appToken }));
}

/** Starts the Outlook PKCE sign-in; the caller opens `auth_url` in the browser. */
export function connectOutlook(clientId?: string, tenant?: string): Promise<{ auth_url: string }> {
  return bridgeRequest("/integrations/outlook/connect", jsonInit("POST", { client_id: clientId || null, tenant: tenant || null }));
}

export function disconnectSource(source: MessageSourceName): Promise<unknown> {
  return bridgeRequest(`/integrations/${source}`, jsonInit("DELETE"));
}
