# Terminal bridge (`src/codechroma/terminal/`) — not part of the `GraphEngine` pipeline

A separate, self-contained feature: a FastAPI app (`server.py`) exposing `WS /ws/terminal?agent=<name>`
that spawns a real PTY-attached process (`pty_session.py`'s `PtySession`, via `pty.openpty` +
`subprocess.Popen` on Unix or `pywinpty` ConPTY on Windows) and bridges its I/O to the socket.
`agents.py`'s `ALLOWED_AGENTS` is a
three-entry allow-list (`{"shell": [...], "claude": ["claude"], "agent": []}`) — the shell for a
login terminal, and `claude`/`agent` for spawning/resuming an agent session via the `?agent=`
parameter. 061 adds the `agent` key: a **placeholder that is never executed** — `agent_cli` resolves
its real argv at launch through the LLM provider mechanism (`llm/resolve_cli.py` under the
`parallel_agents` call site's `agents` group), so the allow-list just needs the key present for the
front end to name it. 🔴 The `agent`/provider-routed kinds have an empty allow-list entry, so a bare
`?agent=agent` with no live workspace would otherwise fall through to `Popen([])` — the bare-PTY
spawn path in `server.py` guards against an empty argv and fails cleanly instead. A `claude` agent
record is byte-for-byte unchanged: it takes the assistant's
`effective_cli` directly and never consults the providers store (FR-012). Still an allow-list: the
front end names a key, never a command, so the client can't supply its own argv. Nothing in
`engine.py` imports this module or vice versa. Exercised by `tests/unit/test_terminal_server.py` and
`tests/unit/test_pty_session.py` with real WebSocket connections and real spawned subprocesses (not
mocked transport).

The `?workspace=` lookup (which workspace a shell roots in, and which agent session to attach to) is
resolved **per app**, never from module globals: `terminal_socket` reads
`websocket.app.state.services` for `agent_sessions.get(id)` and `workspace_cwd(id)`. When the router
is mounted on the graph bridge (`create_app` includes it), those come from that app's `BridgeServices`;
the standalone `app` in this module serves only a login shell (no `app.state.services`), matching the
pre-refactor standalone behaviour.

Four things about it are load-bearing for how a TUI actually renders, and all four were once wrong:

- 🔴 **The PTY is sized before the child exists.** `pty.openpty()` yields a **0x0** winsize, and
  `POST /agents/{id}/start` can spawn `claude` with no window open at all, so without the
  `TIOCSWINSZ` in `PtySession.__init__` (`DEFAULT_ROWS`/`DEFAULT_COLS`, 30x120 — `settings.terminal`
  in [`config.py`](config-and-prompts.md)) the agent paints its
  banner against zero columns and every later reflow inherits that mess.
- 🔴 **The child gets an explicit `env`** (`_terminal_env`): `TERM=xterm-256color`, `COLORTERM`,
  `FORCE_COLOR`, and a UTF-8 `LANG` when none is set. A Finder-launched desktop app inherits **no
  `TERM`** — `desktop/src/shellPath.ts` repairs `PATH` and nothing else — so inheriting the bridge's
  environment verbatim meant a colourless, degraded TUI in the packaged app only. That base (before
  the overrides) is `dict(os.environ)`, which is how `codechroma_BRIDGE_REPO_PATH` and (in the desktop
  app) `codechroma_BRIDGE_URL` — set by `packaging/bridge_main.py` to the real dynamic port — reach the
  shell a `codechroma-*` skill runs in; see [`desktop-app.md`](desktop-app.md).
- 🔴 **Output is decoded incrementally**, not per `os.read`. A multi-byte character straddling the
  4096-byte read boundary used to become U+FFFD on both sides, which is most of a TUI's box drawing
  and every braille spinner frame.
- Frames are **tagged with one character** — `o` for PTY output, `e` for a JSON error envelope
  (`_OUTPUT_TAG`/`_ERROR_TAG`, decoded by `web/src/terminal/TerminalClient.ts`'s `decodeFrame`).
  Sniffing every frame for JSON instead meant shell output that happened to look like a control
  message was swallowed. Input has a `binary` frame type too (base64 → `PtySession.write_bytes`) so
  xterm's `onBinary` mouse reports survive the JSON/UTF-8 hop.
- 🔴 **`close()` escalates and reaps.** It SIGTERMs the process group, waits
  `terminal.close_grace_seconds` (0.2s), then SIGKILLs a group that ignored TERM, closes the master
  *after* killing (closing first would SIGHUP the foreground group and pre-empt the escalation), and
  reaps from an asyncio task (`_reap_and_notify`). Reaping only works when the task **yields to the
  loop** — a raw `os.waitpid` or a blocking `time.sleep` race asyncio's `ThreadedChildWatcher` and
  intermittently starve under load, leaving a zombie whose exit code never surfaces. So `returncode`
  reads `Popen.poll()` (the watcher's result) rather than doing its own `waitpid`. Writing to a full
  or closed PTY (`write`/`write_bytes`, incl. a paste into a busy agent) swallows `EAGAIN`/`EIO`
  instead of throwing out of the socket handler.

The browser side is `web/src/terminal/useXtermSession.ts` — see
[`docs/architecture/web-panels.md`](web-panels.md).
