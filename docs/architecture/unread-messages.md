# Unread messages panel (Slack + Outlook)

A rail button with an unread badge opens a side panel over the canvas listing every unread Slack and Outlook message, newest first, in one flat list. Clicking an item opens it in Slack (`slack://` deep link; an "in browser" link carries the web permalink) or Outlook (`webLink`). Read-only: CodeChroma never replies, never marks anything read, and writes nothing to disk except the sign-in tokens. Plan and decisions: [`docs/planning/029-unread-messages.md`](../planning/029-unread-messages.md).

C# bridge only, like workflows; the Python bridge has no mirror (gap recorded in `docs/planning/012-csharp-bridge.md`). On the mock bridge (`VITE_ENGINE_BRIDGE_URL` unset) the panel says messages are unavailable.

## Bridge (`dotnet/CodeChroma.Bridge/Messages/`)

```
Slack Socket Mode ──► SlackSource ─┐
Graph poll (60 s) ──► OutlookSource┼─► UnreadFeed (in memory) ──► GET /messages/unread
                                   │                          └─► ws ping "messages-changed" ──► UnreadPanel
Keychain ◄── ITokenVault ──────────┘
```

- `UnreadFeed.cs`: `UnreadItem` (wire fields plus an in-memory `Group` = Slack conversation / Graph folder id) and the `IMessageSource` port (`RecheckAsync` full re-read, `RunAsync` background loop). The feed keeps one slot per source (`state` connected/disconnected/error, `error`, `synced_at`, items). `Replace`/`ReplaceWhere`/`Upsert`/`RemoveWhere` fire the `messages-changed` ping (no workspace key, so every tab gets it) only when items or state change, never for a bare `synced_at` bump. ⚠ `Fail` keeps the last good items: a failed poll shows an error note, it does not empty the list.
- `SlackSource.cs`: `SlackApi` (Bearer, `ok:false` → `SlackApiException`, 429 retried with `Retry-After` capped at 30 s). Full re-check = `auth.test` (cached identity), `users.conversations` (public, private, mpim, im; 200 per page, capped at 1000 conversations), then per conversation (4 in parallel) `conversations.info` → `last_read` and `conversations.history?oldest=last_read` (20 per conversation). A message counts when someone else wrote it, it has no subtype or one of `thread_broadcast`/`file_share`/`bot_message`/`me_message`, and it is not a thread reply. Socket Mode (`apps.connections.open` with the `xapp-` token) acks every envelope, upserts a new message, drops an item on `message_deleted`, and clears a conversation when the user writes in it (Slack marks it read then). Slack sends no user event when a channel is read elsewhere, so `RunAsync` re-reads only the conversations that still hold items every 60 s (`SlackOpenRecheck`, the "disappears once read" bound) and does a full re-check every 15 min (`SlackFullRecheck`), at start, on every socket reconnect and on window focus. Previews flatten mrkdwn (`<url|label>`, `<@U…>`, `<#C…|name>`, `<!here>`, HTML entities) and cap at 200 chars.
- `OutlookSource.cs`: `OutlookAuth` is auth code + PKCE (S256) for a public client, no secret, scopes `offline_access User.Read Mail.Read`. The redirect is the bridge itself, `http://localhost:<bridge port>/integrations/outlook/callback` (Entra matches `http://localhost` on any port for public clients). `OutlookSource` polls `GET /me/messages?$filter=isRead eq false` every 60 s (`OutlookPoll`), follows `@odata.nextLink` up to 500 items, and drops messages whose `parentFolderId` is Junk or Deleted Items (well-known folders, resolved once). `where` is the folder display name ("Mail" for a folder not in the top-level list). Access tokens stay in memory; a rotated refresh token is saved back to the vault. `invalid_grant` becomes an error telling the user to connect again.
- `TokenVault.cs`: `ITokenVault` — `DpapiVault` (Windows, DPAPI CurrentUser over the vault file), `MacKeychainVault` (`security` generic passwords, service `codechroma`), `SecretToolVault` (Linux libsecret via `secret-tool`, secret on stdin), and `FileVault` — the 0600 fallback when `secret-tool` is missing or has no session, with a `Warning` shown in Settings. The file is `~/.codechroma/integration-tokens.json` (`UserPaths.IntegrationTokens`, `codechroma_INTEGRATION_TOKENS_FILE` overrides). Keys: `slack.user_token`, `slack.app_token`, `outlook.refresh_token`, `outlook.client_id` (own client only), `outlook.tenant` (non-default only). ⚠ On macOS the token is passed to `security` on argv for the moment of the call.
- `MessagesService.cs`: hosted service that starts the saved sources with the bridge, validates and saves Slack tokens (`auth.test` + `apps.connections.open` must both succeed), runs the PKCE handshake (pending state in memory, 10 min), disconnects (stop + vault delete + feed clear) and throttles focus re-checks to one per 15 s. `MessagesOptions` holds every endpoint, interval and the socket connector; tests swap the `HttpMessageHandler` and `SocketConnector`. `DefaultOutlookClientId` comes from `codechroma_OUTLOOK_CLIENT_ID`; ⚠ until the project registers its publisher-verified multi-tenant Entra app it is null and the user must enter their own client id.
- `slack-manifest.json` (embedded): the internal Slack app the user creates (user scopes `channels:read`, `groups:read`, `im:read`, `mpim:read`, `*:history`, `users:read`; user events `message.channels/groups/im/mpim`; Socket Mode on). The app-level token (`connections:write`) is created by hand under Basic Information.

### Routes (`Routes/MessageRoutes.cs`)

| Route | Body / answer |
|---|---|
| `GET /messages/unread` | `{sources: {slack, outlook: {state, error, synced_at}}, items: [{id, source, where, from, preview, at, open_url, web_url}]}`, newest first |
| `POST /messages/refresh` | focus re-check of every running source; `{started}` (false when throttled) |
| `GET /integrations` | `{slack: {connected, state, error, workspace, user}, outlook: {connected, state, error, account, client_id, tenant, default_client_available}, token_storage: {backend, warning}}` |
| `GET /integrations/slack/manifest` | the manifest JSON |
| `POST /integrations/slack` | `{user_token: "xoxp-…", app_token: "xapp-…"}` → `{workspace, user}`; 400 on a wrong prefix or a token Slack refuses (nothing saved) |
| `POST /integrations/outlook/connect` | `{client_id?, tenant?}` → `{auth_url}`; 400 when no client id is available |
| `GET /integrations/outlook/callback` | Entra redirect; exchanges the code and answers a small HTML page (400 for an unknown/expired state) |
| `DELETE /integrations/{slack\|outlook}` | stops the source, deletes its tokens, clears its items |

Tests: `dotnet/CodeChroma.Bridge.Tests/Messages/` (`MessageFakes.cs` fake Slack/Graph/login handler + scripted socket; `UnreadFeedTests`, `SlackSourceTests`, `OutlookSourceTests`, `MessageRoutesTests`, `TokenVaultTests`). `BridgeHost` registers a `MemoryVault`, so no test touches a real keychain.

## Web (`web/src/messages/`)

- `messagesClient.ts`: the wire types and fetchers (`bridgeRequest`).
- `messagesStore.ts`: one global `PanelStore` holding the feed (survives workspace switches); `useMessagesSync(client)` loads once, re-fetches on `EngineClient.subscribeMessages` (`messages-changed`, listed in `GLOBAL_EVENT_TYPES`), and on window focus calls `POST /messages/refresh` and re-fetches.
- `UnreadPanel.tsx`: `MessagesRailButton` (rail, under the terminal button; badge = item count, owns the sync) and `UnreadPanel` (absolute, right side of `.canvas-area`, clears the docked terminal via `--terminal-clearance`). Per-source notes show "not connected" or the error.
- `IntegrationsPanel.tsx`: Settings › Integrations. Slack: steps, the manifest (copyable), the two token fields; Outlook: optional own client id (required when `default_client_available` is false) and tenant, Connect opens `auth_url` in the browser and polls `/integrations` every 2 s until connected. Shows the token-storage warning.
- Tests: `UnreadPanel.test.tsx`, `IntegrationsPanel.test.tsx`.

Desktop shell: `CodeChroma.Shell/ExternalLinks.cs` lets `http`, `https` and `slack` navigations leave the WebView (`MainWindow.axaml.cs` `NavigationStarting`), so the `slack://` deep link reaches the Slack app.
