import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useEngineClient } from "../engine-client/EngineClientContext";
import type { MessageSourceName, UnreadFeed, UnreadItem } from "./messagesClient";
import {
  messagesStore,
  unreadCount,
  useIsMessagesPanelOpen,
  useMessagesError,
  useMessagesFeed,
  useMessagesSync,
} from "./messagesStore";
import "./messages.css";

const SOURCE_LABEL: Record<MessageSourceName, string> = { slack: "Slack", outlook: "Outlook" };

/** The rail control: toggles the unread panel and badges the unread count; it also owns the feed sync. */
export function MessagesRailButton() {
  const client = useEngineClient();
  useMessagesSync(client);
  const open = useIsMessagesPanelOpen();
  const count = unreadCount(useMessagesFeed());
  const label = count > 0 ? `Unread messages (${count})` : "Unread messages";

  return (
    <RailButton
      label={open ? "Close unread messages" : label}
      tooltip={label}
      className="messages-toggle-button"
      testId="messages-toggle-button"
      pressed={open}
      ariaControls="unread-panel"
      onClick={messagesStore.toggle}
    >
      <RailIcon name="messages" />
      {count > 0 && (
        <span className="messages-badge" data-testid="messages-badge" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </RailButton>
  );
}

/** "09:42" today, "Nov 23" otherwise, in the viewer's locale. */
function formatAt(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return when.toDateString() === now.toDateString()
    ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : when.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Opens the message in Slack or Outlook; nothing is marked read here, the source decides. */
function openItem(item: UnreadItem): void {
  window.open(item.open_url, "_blank", "noopener");
}

function SourceNotes({ feed }: { feed: UnreadFeed }) {
  const notes = (Object.keys(SOURCE_LABEL) as MessageSourceName[]).flatMap((name) => {
    const status = feed.sources[name];
    if (!status) return [];
    if (status.state === "error") return [{ name, text: `${SOURCE_LABEL[name]}: ${status.error ?? "sync failed"}`, error: true }];
    if (status.state === "disconnected") return [{ name, text: `${SOURCE_LABEL[name]} is not connected`, error: false }];
    return [];
  });
  if (notes.length === 0) return null;
  return (
    <ul className="unread-notes">
      {notes.map((note) => (
        <li key={note.name} className={note.error ? "unread-note unread-note-error" : "unread-note"} data-testid={`unread-note-${note.name}`}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}

/** The side panel over the canvas: every unread Slack and Outlook message, newest first, one flat list. */
export function UnreadPanel() {
  const open = useIsMessagesPanelOpen();
  const feed = useMessagesFeed();
  const error = useMessagesError();
  if (!open) return null;

  const allDisconnected = feed && Object.values(feed.sources).every((s) => s.state === "disconnected");

  return (
    <aside id="unread-panel" className="unread-panel" data-testid="unread-panel" aria-label="Unread messages">
      <header className="unread-panel-header">
        <h2>Unread</h2>
        {feed && <span className="unread-panel-count">{feed.items.length}</span>}
        <button type="button" className="unread-panel-close" aria-label="Close unread messages" onClick={messagesStore.hide}>
          ×
        </button>
      </header>
      {error && !feed && <p className="unread-empty" data-testid="unread-error">Messages are unavailable: {error}</p>}
      {feed && <SourceNotes feed={feed} />}
      {feed && allDisconnected && (
        <p className="unread-empty">Connect Slack or Outlook in Settings › Integrations to see unread messages here.</p>
      )}
      {feed && !allDisconnected && feed.items.length === 0 && <p className="unread-empty">Nothing unread.</p>}
      {feed && feed.items.length > 0 && (
        <ul className="unread-list" data-testid="unread-list">
          {feed.items.map((item) => (
            <li key={item.id} className="unread-item">
              <button type="button" className="unread-item-open" onClick={() => openItem(item)} title={`Open in ${SOURCE_LABEL[item.source]}`}>
                <span className={`unread-source unread-source-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
                <span className="unread-item-top">
                  <span className="unread-from">{item.from}</span>
                  <span className="unread-where">{item.where}</span>
                  <time className="unread-at" dateTime={item.at}>{formatAt(item.at)}</time>
                </span>
                <span className="unread-preview">{item.preview}</span>
              </button>
              {item.web_url && (
                <a className="unread-web" href={item.web_url} target="_blank" rel="noreferrer">
                  in browser
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
