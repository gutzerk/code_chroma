# Report an issue — the in-app "Create issue" dialog

Issue [#88](https://github.com/gutzerk/code_chroma/issues/88): lets a user file a bug or suggest an
idea without leaving the app. There is no server-side piece — the dialog is pure web (one React
component) and talks to GitHub only by opening a prefilled URL in the system browser/a new tab, so
it needs no token, no stored credentials, and works identically in the plain web canvas and the
desktop app.

## Entry point

`web/src/assistant/SettingsDialog.tsx`'s "Report an issue" row opens
`web/src/assistant/CreateIssueDialog.tsx` as a third settings category, alongside "LLM" and
"Updates" (see [`assistant-settings.md`](assistant-settings.md)) — same one-modal-at-a-time rule
(`openCategory`), reached via the gear on the canvas chrome.

## The dialog (`web/src/assistant/CreateIssueDialog.tsx`)

- Fields: a required **Title**, a multi-line **Description** (Markdown supported), a single-select
  **Label** pill group (`bug` / `enhancement` / `question` / `documentation`, default `bug`), and an
  **"Attach app version and system info"** checkbox (default on).
- "Create issue" stays disabled until Title is non-empty. Clicking it builds
  `https://github.com/gutzerk/code_chroma/issues/new?title=…&body=…&labels=…` (`buildIssueUrl`) —
  every field URL-encoded via `URLSearchParams` — and opens it with `window.open(url, "_blank",
  …)`, which in the desktop app is intercepted by `main.ts`'s `setWindowOpenHandler` and handed to
  `shell.openExternal` (the same path the Updates panel's release-notes link already uses); in a
  plain browser it opens an ordinary new tab. This is deliberately "Option A" from the issue (a
  prefilled link, not the GitHub API) — no OAuth/token handling, the user reviews and submits the
  issue themselves on GitHub.
- When the checkbox is on, `systemInfoLine()` appends `App: CodeChroma <version>` /
  `OS: <platform>` to the end of the body. The version comes from the existing
  `window.codechromaUpdates` bridge (`UpdatesPanel.tsx`'s `UpdatesApi`) and resolves to `"unknown"`
  outside the desktop app; the OS string is `navigator.platform` (e.g. `Win32`, `MacIntel`,
  `Linux x86_64`) mapped to a friendly label — deliberately **not** a hostname, username, or file
  path, matching the issue's privacy requirement.
- `buildIssueUrl` truncates the body (never the title/label) if the assembled URL would exceed
  `MAX_URL_LENGTH` (8000 chars), so a long description can't silently produce a dead link.
- States: `idle` → `submitting` (button reads "Creating…", disabled) → `success` (footer note
  swaps to "Opened in your browser…") or `error` (inline `role="alert"` message, form content
  untouched — nothing is cleared on failure).
- Back/Cancel both call `requestClose()`: if the title or description is non-empty and the dialog
  hasn't already succeeded, it swaps the dialog body for a small inline "Discard this issue?"
  confirmation (`confirmingDiscard` state) rather than opening a second `ModalDialog` — nesting two
  would double-bind the capturing `Escape` keydown listener (see `ModalDialog.tsx`'s comment on
  `SettingsDialog.tsx`'s one-modal-at-a-time rule).
- Styling matches the issue's Figma spec exactly (`#16171c` background, `#8faef2` accent, IBM Plex
  Sans/Mono, 480px width) — the same dark-card system `UpdatesPanel.tsx`'s `.updates-dialog`
  already uses, but kept in its own `.issue-*` CSS class vocabulary in `web/src/styles.css` so the
  two dialogs stay decoupled. The accent and background are tokenized as `--issue-dialog-accent` /
  `--issue-dialog-bg` in `:root` per the issue's "make these design tokens" note.

## Tests

- `web/src/assistant/CreateIssueDialog.test.tsx` — title-gates the submit button, single-select
  label pills, the built URL's title/body/labels query params, the appended version+OS line (and
  that it never contains a path), the success/confirm-discard states.
- `web/src/assistant/SettingsDialog.test.tsx` — the "Report an issue" row opens/closes the dialog.

## Out of scope (v1)

- Posting directly via the GitHub API (issue's "Option B") — would need OAuth device flow, token
  storage, and rate-limit handling; the prefilled-link path needs none of that.
- Showing a GitHub-side "issue created" link — Option A hands off to the browser before the issue
  exists, so there is no issue number to report back.
