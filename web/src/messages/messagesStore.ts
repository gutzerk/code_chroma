import { useEffect, useSyncExternalStore } from "react";
import { PanelStore, useIsPanelOpen } from "../canvas/panelStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { BridgeHttpError } from "../util/httpJson";
import { getUnread, refreshMessages, type UnreadFeed } from "./messagesClient";

/** Whether a failed fetch means this bridge has no messages feed at all (mock, Python bridge, no bridge). */
function isUnsupported(err: unknown): boolean {
  if (err instanceof BridgeHttpError) return err.status === 404 || err.status === 405;
  return err instanceof Error && err.message.startsWith("no bridge");
}

/** The unread feed the rail badge and the panel share, plus the panel's open state; machine-wide, so global. */
class MessagesStore extends PanelStore {
  private feed: UnreadFeed | null = null;
  private error: string | null = null;
  private loading = false;
  private again = false;
  private unsupported = false;
  private integrationsOpen = false;

  getFeed = (): UnreadFeed | null => this.feed;
  hide = (): void => this.closePanel();
  getError = (): string | null => this.error;
  isUnsupported = (): boolean => this.unsupported;
  isIntegrationsOpen = (): boolean => this.integrationsOpen;

  /** The rail click: with no source connected it opens Integrations (panel stays shut), otherwise toggles the panel. */
  activate = (): void => {
    if (this.feed && noSourceConnected(this.feed)) {
      this.closePanel();
      this.integrationsOpen = true;
      this.emit();
      return;
    }
    this.toggle();
  };

  openIntegrations = (): void => {
    this.closePanel();
    this.integrationsOpen = true;
    this.emit();
  };

  closeIntegrations = (): void => {
    this.integrationsOpen = false;
    this.emit();
  };

  /** Re-fetches the feed; a call during a fetch queues exactly one more. */
  load = async (): Promise<void> => {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      this.feed = await getUnread();
      this.error = null;
      this.unsupported = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.unsupported = isUnsupported(err);
    } finally {
      this.loading = false;
      this.emit();
    }
    if (this.again) {
      this.again = false;
      await this.load();
    }
  };

  /** Test-only full reset. */
  reset = (): void => {
    this.feed = null;
    this.error = null;
    this.loading = false;
    this.again = false;
    this.unsupported = false;
    this.integrationsOpen = false;
    this.closePanel();
  };
}

export const messagesStore = new MessagesStore().markGlobalStore();

export function useMessagesFeed(): UnreadFeed | null {
  return useSyncExternalStore(messagesStore.subscribe, messagesStore.getFeed);
}

export function useMessagesError(): string | null {
  return useSyncExternalStore(messagesStore.subscribe, messagesStore.getError);
}

/** True once the bridge answered that it has no messages routes, so the rail hides the button. */
export function useMessagesUnsupported(): boolean {
  return useSyncExternalStore(messagesStore.subscribe, messagesStore.isUnsupported);
}

export function useIsIntegrationsOpen(): boolean {
  return useSyncExternalStore(messagesStore.subscribe, messagesStore.isIntegrationsOpen);
}

export function useIsMessagesPanelOpen(): boolean {
  return useIsPanelOpen(messagesStore);
}

/** Keeps the feed current: loads once, re-fetches on every `messages-changed` ping, and asks for a re-check on window focus. */
export function useMessagesSync(client: EngineClient): void {
  useEffect(() => {
    void messagesStore.load();
    const unsubscribe = client.subscribeMessages(() => void messagesStore.load());
    const onFocus = () => {
      if (messagesStore.isUnsupported()) return;
      refreshMessages().catch(() => undefined);
      void messagesStore.load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [client]);
}

/** How many items the badge shows. */
export function unreadCount(feed: UnreadFeed | null): number {
  return feed?.items.length ?? 0;
}

/** True when every source is disconnected (an erroring source still counts as set up). */
export function noSourceConnected(feed: UnreadFeed): boolean {
  return Object.values(feed.sources).every((status) => status.state === "disconnected");
}
