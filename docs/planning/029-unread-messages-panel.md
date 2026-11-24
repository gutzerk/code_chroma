# 029 — Unread messages panel (Slack + Outlook)

Status: Specification

Prototype: Design canvas "CodeChroma — Messages (Slack + Outlook)" (artboards 1 Connect, 2 Inbox, 3 Thread). This plan keeps a small subset of it; see "Out of scope".

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
| Python bridge | C#-only feature (like workflows). Record the gap in `012-csharp-bridge.md` when it lands. |
| Slack app | The user creates it from a manifest CodeChroma ships (internal app, no Marketplace review, no client secret on our side). The user pastes the user token (`xoxp-`) and app-level token (`xapp-`). |
| Slack sync | Socket Mode for new messages, plus a full unread re-check at start, on reconnect and on window focus. |
| Outlook auth | CodeChroma's own multi-tenant public client in Entra, auth code + PKCE with a loopback redirect, no secret. Optional "own client id" field for tenants that require admin consent. |
| Outlook sync | Poll every 60 s and on window focus. |
| Tokens | OS keychain: DPAPI (Windows), Keychain (macOS), libsecret (Linux). No libsecret: a 0600 file with a warning in the UI. |
| Message storage | None. No message text, no ids, no read flags on disk. The list lives in bridge memory and is rebuilt on every start. |
| Unread state | Taken from the source (Slack `last_read`, Graph `isRead`). CodeChroma never writes it back. |
| Accounts | One Slack workspace and one Outlook mailbox per user, shared by every open repo. |
| UI | A rail button with an unread badge opens a side panel over the canvas (same slot as the terminal panel). Plus a Settings > Integrations section to connect/disconnect. |

## Out of scope (from the prototype)

Create task, Suggest a task, Linked to tasks, Needs reply, Planner/Builder panel, attaching messages to agents, matching messages to code boxes ("Found in your code", Show on canvas), replies, status cards in threads, desktop notifications, channel/folder chips, search, thread view.

## Wire shapes

`GET /messages/unread`:

```json
{
  "sources": {
    "slack": {"state": "connected | disconnected | error", "error": null, "synced_at": "2026-11-24T09:42:00Z"},
    "outlook": {"state": "connected", "error": null, "synced_at": "2026-11-24T09:41:30Z"}
  },
  "items": [
    {"id": "slack:T1/C1/1732441320.000200", "source": "slack", "where": "#backend", "from": "Maya Chen",
     "preview": "Three runs dropped nodes today...", "at": "2026-11-24T09:42:00Z", "open_url": "slack://channel?team=T1&id=C1&message=..."}
  ]
}
```

`id` is in-memory only (React key and dedupe). Push: `WS` ping `messages-changed` on the existing bridge event socket; the panel re-fetches.

Integrations: `GET /integrations`, `POST /integrations/slack` (tokens), `POST /integrations/outlook/connect` (starts PKCE, returns the browser URL), `DELETE /integrations/{source}`.

## Architecture

```
Slack Socket Mode ──► SlackSource ─┐
Graph poll (60 s) ──► OutlookSource┼─► UnreadFeed (in memory) ──► GET /messages/unread
                                   │                          └─► ws ping "messages-changed" ──► UnreadPanel (web)
Keychain ◄── TokenVault ───────────┘
```

C# (new, `dotnet/CodeChroma.Bridge/Messages/`): `IMessageSource` port, `SlackSource.cs`, `OutlookSource.cs`, `UnreadFeed.cs`, `TokenVault.cs`; routes in `Routes/MessageRoutes.cs`. Tests in `dotnet/CodeChroma.Bridge.Tests` against fake Slack/Graph HTTP handlers.
Web (new, `web/src/messages/`): `UnreadPanel.tsx`, `messagesClient.ts`, rail button; Integrations section in settings.
The Slack manifest lives in `dotnet/CodeChroma.Bridge/Messages/slack-manifest.json` and is shown in the connect dialog.

## Scopes

- Slack user token: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`. App token: `connections:write`. User events: `message.channels`, `message.groups`, `message.im`, `message.mpim`.
- Graph: `Mail.Read`, `User.Read`, `offline_access`.

## Risks to check first (spike)

1. **Slack has no public "all unread" call.** The feed must list the user's conversations (`users.conversations`) and compare each `last_read` with the latest message, which costs one or more calls per conversation. With hundreds of channels the start-up re-check may be slow under Tier 3 limits. Measure on a real workspace; if too slow, fall back to DMs + mentions + channels with recent activity.
2. **Read elsewhere.** Verify which events (if any) Socket Mode sends when the user reads a channel in Slack. If none, "disappears once read" relies on the periodic re-check, and its interval needs a number.
3. **Graph delta is per folder.** "All unread in every folder" is one `GET /me/messages?$filter=isRead eq false` query (excluding Junk and Deleted Items), polled every 60 s, rather than a delta query.
4. **Entra publisher setup.** A multi-tenant app needs a publisher-verified registration owned by the project; some tenants block user consent entirely (hence the own-client-id field).
5. **libsecret** may be missing on Linux desktops; the 0600 fallback must be visible to the user.

## Stages

1. Spike: risks 1–3 against real accounts; write the numbers here.
2. Bridge: `TokenVault`, `OutlookSource`, `UnreadFeed`, routes, tests.
3. Bridge: `SlackSource` (manifest, Socket Mode, re-check), tests.
4. Web: rail button + `UnreadPanel` + Integrations settings; docs (`docs/architecture/unread-messages.md`, CLAUDE.md map row, `012` gap note).
