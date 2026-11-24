import { useEffect, useSyncExternalStore } from "react";
import { PanelStore, useIsPanelOpen } from "../canvas/panelStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { getUnread, refreshMessages, type UnreadFeed } from "./messagesClient";

/** The unread feed the rail badge and the panel share, plus the panel's open state; machine-wide, so global. */
class MessagesStore extends PanelStore {
  private feed: UnreadFeed | null = null;
  private error: string | null = null;
  private loading = false;
  private again = false;

  getFeed = (): UnreadFeed | null => this.feed;
  hide = (): void => this.closePanel();
  getError = (): string | null => this.error;

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
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
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

export function useIsMessagesPanelOpen(): boolean {
  return useIsPanelOpen(messagesStore);
}

/** Keeps the feed current: loads once, re-fetches on every `messages-changed` ping, and asks for a re-check on window focus. */
export function useMessagesSync(client: EngineClient): void {
  useEffect(() => {
    void messagesStore.load();
    const unsubscribe = client.subscribeMessages(() => void messagesStore.load());
    const onFocus = () => {
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
