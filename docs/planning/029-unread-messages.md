# 029 — Unread messages panel (Slack + Outlook)

Status: In progress (stages 2–4 built; stage 1 spike against real accounts still open)

Prototype: Design canvas "CodeChroma — Messages (Slack + Outlook)" (artboards 1 Connect, 2 Inbox, 3 Thread). This plan keeps a small subset of it; see "Out of scope".
Current-state reference: [`docs/architecture/unread-messages.md`](../architecture/unread-messages.md).

## Problem

Work tools live in separate windows. To see whether anyone wrote to you, you leave CodeChroma and open Slack and Outlook.

## Goal

One window: a rail panel in CodeChroma lists every unread Slack and Outlook message in one flat list. It is a view of unread items, not a Slack or Outlook replacement. Clicking an item opens it in Slack or Outlook.

Done means: with Slack and Outlook connected, every unread message appears in the panel within a minute, disappears once it is read in Slack/Outlook, and nothing but the OAuth tokens is written to disk.

## Decisions (grill session 2026-11-24)

| Topic | Decision |
|---|---|
| Scope | Slack + Outlook, read-only. No replies, no marking read, no status cards in threads. |
| What is shown | All unread messages, one flat list, newest first. No channel/folder picker, no filters, no tabs. |
| Click | Opens the message in Slack (`slack://` deep link, web permalink fallback) or Outlook (`webLink`). No in-app thread view. |
| Where it runs | Locally in the C# bridge (`dotnet/CodeChroma.Bridge`). No cloud relay, no webhooks. |
| Python bridge | C#-only feature (like workflows). Gap recorded in `012-csharp-bridge.md`. |
| Slack app | The user creates it from a manifest CodeChroma ships (internal app, no Marketplace review, no client secret on our side). The user pastes the user token (`xoxp-`) and app-level token (`xapp-`). |
| Slack sync | Socket Mode for new messages, plus a full unread re-check at start, on reconnect and on window focus. |
| Outlook auth | CodeChroma's own multi-tenant public client in Entra, auth code + PKCE with a loopback redirect, no secret. Optional "own client id" field for tenants that require admin consent. |
| Outlook sync | Poll every 60 s and on window focus. |
| Tokens | OS keychain: DPAPI (Windows), Keychain (macOS), libsecret (Linux). No libsecret: a 0600 file with a warning in the UI. |
| Message storage | None. No message text, no ids, no read flags on disk. The list lives in bridge memory and is rebuilt on every start. |
| Unread state | Taken from the source (Slack `last_read`, Graph `isRead`). CodeChroma never writes it back. |
| Accounts | One Slack workspace and one Outlook mailbox per user, shared by every open repo. |
| UI | A rail button with an unread badge opens a side panel over the canvas (same slot as the terminal panel). Plus a Settings > Integrations section to connect/disconnect. |

## Decisions made while building

| Topic | Decision |
|---|---|
| Read elsewhere (risk 2) | Assumed: Socket Mode sends no user event when a channel is read in another client. So every 60 s the bridge re-reads only the conversations that still hold unread items (cheap: a handful of calls), and does a full re-check every 15 min on top of start/reconnect/focus. Writing in a conversation clears it at once (Slack marks it read). |
| Slack cost (risk 1) | Full re-check = 2 calls per conversation (`conversations.info` + `conversations.history`), 4 in parallel, 429 honoured; capped at 1000 conversations and 20 messages per conversation. Not yet measured on a large workspace. |
| Graph (risk 3) | One `GET /me/messages?$filter=isRead eq false` per poll, up to 500 items; Junk and Deleted Items dropped by `parentFolderId`. |
| Entra client (risk 4) | Not registered yet. The default client id comes from `codechroma_OUTLOOK_CLIENT_ID`; with none, Settings asks for the user's own client id (redirect URI `http://127.0.0.1`). The redirect lands on the bridge's own `/integrations/outlook/callback`. |
| Slack fallback link | Items carry an extra `web_url` (the permalink) next to `open_url`; the panel shows it as "in browser". The desktop shell now lets `slack://` navigations out (`ExternalLinks.cs`). |
| Focus | The web posts `POST /messages/refresh` on window focus; the bridge throttles it to one per 15 s. |

## Out of scope (from the prototype)

Create task, Suggest a task, Linked to tasks, Needs reply, Planner/Builder panel, attaching messages to agents, matching messages to code boxes ("Found in your code", Show on canvas), replies, status cards in threads, desktop notifications, channel/folder chips, search, thread view.

## Wire shapes

See the route table in [`docs/architecture/unread-messages.md`](../architecture/unread-messages.md). `id` is in-memory only (React key and dedupe). Push: `messages-changed` on the existing bridge event socket; the panel re-fetches.

## Scopes

- Slack user token: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`. App token: `connections:write`. User events: `message.channels`, `message.groups`, `message.im`, `message.mpim`.
- Graph: `Mail.Read`, `User.Read`, `offline_access`.

## Risks to check first (spike)

1. **Slack has no public "all unread" call.** Built as above; measure start-up re-check time on a workspace with hundreds of channels. If too slow, fall back to DMs + mentions + channels with recent activity.
2. **Read elsewhere.** Verify on a real workspace that no Socket Mode event arrives when a channel is read in Slack; if one does, handle it and drop the 60 s open-conversation re-check.
3. **Graph delta is per folder.** Built as one filtered query per poll; confirm the query cost and that `isRead eq false` without `$orderby` is accepted on large mailboxes.
4. **Entra publisher setup.** Register the publisher-verified multi-tenant public client owned by the project and ship its id as the default.
5. **libsecret** may be missing on Linux desktops; the 0600 fallback and its Settings warning are built.

## Stages

1. Spike: risks 1–3 against real accounts; write the numbers here. **Open** (needs real Slack and Microsoft 365 accounts).
2. Bridge: `TokenVault`, `OutlookSource`, `UnreadFeed`, routes, tests. **Done.**
3. Bridge: `SlackSource` (manifest, Socket Mode, re-check), tests. **Done.**
4. Web: rail button + `UnreadPanel` + Integrations settings; docs (`docs/architecture/unread-messages.md`, CLAUDE.md map row, `012` gap note). **Done.**
