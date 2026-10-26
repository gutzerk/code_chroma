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
  `TERM`** — the bridge's captured runtime environment repairs `PATH` and not `TERM` — so inheriting the bridge's
  environment verbatim meant a colourless, degraded TUI in the packaged app only. That base (before
  the overrides) is `dict(os.environ)`, which is how `codechroma_BRIDGE_REPO_PATH` and (under the C# shell's bridge)
  `CODECHROMA_BRIDGE_URL` — set to the real dynamic port — reach the
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

- ⚠ **ConPTY blocks on its startup `ESC[c` query.** Until something replies, a Windows child's output is withheld entirely. `PtySession._answer_conpty_query` answers it server-side (once), because an agent window's PTY starts before any xterm attaches and a late attach only gets a screen redraw. Without it the agent window is blank (issue #128). Test: `tests/unit/test_pty_session_windows.py`.


## C# host (`dotnet/CodeChroma.Bridge/Terminal/`, `Routes/TerminalRoutes.cs`)

The C# bridge serves `WS /ws/terminal` with the same protocol (`o`/`e` tags, `input`/`binary`/`resize` frames, 4404/4409 close codes, 30x120 default PTY) on `Porta.Pty` (ConPTY / openpty). 🔴 It fixes the frozen-Python-on-Windows bug where the socket closed with 1000 about 20ms after open (shown as `[detached]`): the PTY is owned by `PtyHost`, not by the socket handler, and a plain terminal only closes when its child exits or the client leaves; proven by `TerminalSocketTests`/`PtyHostTests` against real `cmd.exe`. Closing a window on an agent session only detaches (`AgentSession.Detach`); the process keeps running and a new window is seeded with `ScreenTap.Render()`. A `?workspace=` naming a registered non-agent workspace opens a shell in that workspace's root (Python reports "the agent is not running" for any registered id). Not ported: foreground-process probing for the status LED.

C# bridge: agent windows (`AgentSessionRegistry.Start`, env computed before its lock) and the plain terminal panel spawn their PTY with `RuntimeEnvironment.TerminalEnv`/`TerminalEnvAsync` (#294): the inherited process env under the login-shell snapshot under the caller's overrides, uncleaned so `codechroma_*` settings and exported functions survive (unlike `SpawnEnv`, which `Clean()`s it for CLI subprocesses). The wait on the login-shell capture is bounded by `RuntimeEnvironment.TerminalWait` (10s, then the inherited env) and the socket's `aborted` token. `PtyHost.Start` forces `TERM`/`COLORTERM`/`FORCE_COLOR` after the merge, injects `LANG` only when the merged env has neither `LC_ALL` nor `LANG`, and compares keys case-insensitively on Windows. The Python terminal bridge is unchanged.
