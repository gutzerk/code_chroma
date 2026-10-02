# Execution trace playback (`src/codechroma/trace/`) — not part of the `GraphEngine` pipeline

Record a real run of a target repo and replay its actual call path on the canvas: which functions
ran, in what order, how long each took, and where an exception unwound the stack. Unlike the C1/
Patterns/Impact diagrams this is not a static view derived from source — it's a recording of one
concrete execution, mapped onto the hierarchy `GraphEngine.analyze()` already built. Original design
doc: `docs/planning/039-execution-trace-playback/039-execution-trace-playback.md` (moved from the
repo root's `dataflow-visualization-options.md`); this file is the current, living description of
what actually shipped. The design's four phases (capture → serve → replay → live stream) all
shipped, including the "v2" live-stream phase the planning doc flagged as future work.

## Backend: capture (`src/codechroma/trace/`)

- **`tracer.py`'s `Tracer`** — records an ordered `list[TraceStep]` for one run. Two interchangeable
  backends: `sys.monitoring` (PEP 669, the default — low overhead, no per-line callback) registers
  `PY_START`/`PY_RETURN`/`RAISE`/`PY_UNWIND`/`EXCEPTION_HANDLED` callbacks under one dynamically
  acquired tool id (`_acquire_tool_id`, tries the settings id then 0-5, backs off to `settrace` if
  every slot is taken by another profiler); `sys.settrace` is the fallback, driven off `call`/
  `return`/`exception`/`line` events. ⚠ **`capture_args` forces `settrace`** — only it exposes
  `frame.f_locals`; `sys.monitoring`'s callbacks get no frame object, only `code`/offset/value args.
  A frame is resolved to a node id through `FrameMapper` on every callback; `_resolve_code` caches
  the result per `id(code)` object so a hot loop doesn't re-resolve the same function every call.
  A frame outside the repo (mapper returns `None`) makes `_mon_start` return `sys.monitoring.DISABLE`
  for that code object — `sys.monitoring` then stops invoking callbacks for it at all, which is how
  stdlib/site-packages code gets filtered out cheaply instead of per-event.
- **Steps, not spans**: each call emits one `"call"` step and, later, exactly one of `"return"` /
  `"unwind"` (never both) — `_pop` finds the matching stack frame by node id (not strict LIFO), so a
  generator's out-of-order teardown still resolves. 🔴 **Control-flow exceptions are not errors.**
  `StopIteration`/`StopAsyncIteration`/`GeneratorExit` (`_BENIGN_EXCEPTIONS`) unwinding a frame is
  recorded as a normal `"return"`, not `"unwind"` — an exhausted generator or a `with`-block's clean
  teardown would otherwise paint the whole run red. A genuine `"raise"` step is only emitted once per
  live exception (`_current_exc` held by reference, not `id()`, so a GC'd exception's reused id can't
  be mistaken for a new one propagating); `EXCEPTION_HANDLED`/the `line`-event-after-`exception` trick
  (`settrace` path) flips its `TraceError.handled` to `True` without changing `status`.
- **`mapper.py`'s `FrameMapper`** — built once per traced run from `engine.iter_symbols()`
  (`FUNCTION` symbols only): a `(rel_path, qualified_name) -> node_id` dict for the exact-match case,
  plus a per-file sorted `(start_line, end_line, node_id)` list for a line-range fallback
  (`resolve_by_line`, `bisect_right` over line starts). `resolve()` tries the exact qualname first,
  then strips CPython's `<locals>` segments (`_strip_locals`) since tree-sitter's qualnames never
  have them, then falls back to the line index — this is what makes a runtime frame for a nested
  closure or a decorated method still resolve to its enclosing function node id
  (`path::function::qualname`, the same id shape `graph/builder.py` assigns). `to_rel_path` returns
  `None` for anything outside `repo_root`, which is the actual in/out-of-repo filter, not a path
  prefix check on the raw filename.
- **`run.py`'s `record_trace()`** — the one entry point tests and the CLI both call: builds a fresh
  `GraphEngine`, `analyze()`s the repo, builds the `FrameMapper`, then **drops the engine**
  (`del engine`) before executing the traced command — the mapper already copied out the indexes it
  needs, so the graph doesn't sit in memory for the duration of the run. `--cmd` is Python source
  `exec()`'d in-process (not a subprocess) so `sys.monitoring`/`settrace` see the repo's real frames;
  `sys.path` gets the repo root prepended for the duration and every module the run imported is
  popped back out of `sys.modules` afterward, so tracing twice in one process doesn't leak stale
  modules. A clean `sys.exit(0)`/`sys.exit(None)` is `status: "ok"`; any other `SystemExit` code, or
  any other escaping exception, marks the trace `"failed"`.
- **`write_trace()`** persists two files per trace under `<repo>/.codechroma/traces/`: `<id>.json`
  (the full `Trace`, steps sorted by nothing in particular — ordering is enforced on read) and
  `<id>.meta.json` (`Trace.summary()` — id/entry/status/step_count only). The sidecar exists purely
  so the bridge's trace-picker list doesn't have to parse every full trace file just to show a
  one-line summary per run (`bridge/trace_archive.py`'s `_summarize` reads the sidecar when present,
  the full file only as a fallback for an older trace with no sidecar).
- **Models** (`models.py`): `TraceStep` (`seq`, `node_id`, `event: call|return|raise|unwind`,
  `depth`, `caller_node_id`, `ts_ms`, `dur_ms`, `args`, `error`), `TraceError` (`type`, `message`,
  `handled`), `Trace` (`id`, `entry`, `created_at`, `status: ok|failed`, `steps`) — plain dataclasses
  with hand-written `to_dict`/`from_dict`, matching the frontend's snake_case wire shape exactly
  (`web/src/state/types.ts`'s `TraceFrame`/`TraceSummary`/`Trace`).

## CLI entry point

`codechroma-trace = "codechroma.trace.run:main"` (`pyproject.toml`). Usage:

```
codechroma-trace --repo-path /path/to/repo --cmd "import pkg; pkg.main()" \
  [--id <trace-id>] [--capture-args] [--no-monitoring] \
  [--stream http://127.0.0.1:8000] [--repo-id default]
```

`--repo-path`/`--cmd` are the only required flags — a bare run just writes
`<repo>/.codechroma/traces/<id>.json` (+ `.meta.json`) and exits; nothing else needs to be running.
`--stream BRIDGE_URL` additionally pushes each step live to a running graph bridge as it's captured
(needs the optional `websockets` package — `_StreamPublisher` raises a clear `SystemExit` if it's
missing rather than an import traceback). `--repo-id` picks which workspace's canvases the stream
reaches (must match the bridge's `Ws` id, `"default"`/`"main"` etc., not necessarily the same string
as `--repo-path`).

## Live streaming: `--stream` → `trace-ingest` → `trace-stream`

`_StreamPublisher` (`run.py`) opens a **producer** socket to
`WS /repos/{repo_id}/trace-ingest` before the traced command runs, sends `{"type": "trace-start",
"trace_id": ...}`, then one `{"type": "step", "trace_id": ..., "step": {...}}` per captured
`TraceStep` via the `Tracer`'s `on_step` callback (so the canvas sees steps as they happen, not after
the run finishes), then `{"type": "trace-end", "trace_id": ..., "status": ...}` and closes. Every
send swallows its own exception — a dropped stream socket must not blow up the traced run itself, it
only stops showing up live (the run still finishes and still writes its `.json`/`.meta.json` to disk
normally).

`bridge/routes/traces.py`'s `trace_ingest` (producer) and `trace_stream` (consumer) are two ends of
one relay, not a shared socket: `trace_ingest` accepts, then loops `receive_json()` →
`services.trace_connections.broadcast(message, repo_id)`; `trace_stream` is a **consumer** socket
that just registers under `repo_id` and parks (`routes/events.py`'s `hold_open`, the same helper
`/repos/{id}/events` uses). `trace_connections` is its own `ConnectionManager` (`bridge/services.py`),
separate from the one `/repos/{id}/events` uses for "changed"/"plan"/diagram pings — a flood of trace
steps during a live run must never compete with or delay those unrelated pings. Both ends key
connections by `repo_id`, so a producer streaming into `default` only reaches consumers that opened
`trace-stream` on `default` too.

`GET /repos/{repo_id}/traces` (`ws.list_traces()`) and `GET /repos/{repo_id}/traces/{trace_id}`
(`ws.load_trace()`, steps re-sorted by `seq` on the way out — the id-only file on disk is never
assumed pre-sorted) are the record-and-replay half; they don't touch `trace_connections` at all.

## Storage (`bridge/trace_archive.py`, `bridge/workspaces.py`)

`Workspace.artifacts.traces_dir` is `<workspace root>/.codechroma/traces` — plain filesystem, no
`GraphStore`/SQLite involved. `TraceArchive` is deliberately **not** four more methods on
`Workspace`: it's a pure-filesystem reader (`load`/`list_summaries`) testable against a bare
directory with no engine or git. `load()` strips any path a `trace_id` smuggled in via `Path(...).name`
before touching disk — an id is a file name, never a traversal. A `WorkspaceWatchers.trace_watcher`
(`DirWatcher` over `traces_dir`) fires `on_trace_change()` → `{"type": "trace"}` on the *ordinary*
`/repos/{id}/events` socket whenever a trace file appears/changes — this is how the canvas's trace
picker learns a new recording exists even for a run with no `--stream` at all (it re-fetches
`GET .../traces` on the ping; the picker is not the same channel a live run streams over).

## Frontend

- **`state/traceStore.ts`** — the one in-memory playback store (never persisted — same "not backed
  by a document" pattern as `liveStore`): active `Trace`, `stepIndex`, play/pause, speed, a
  `Set<node_id>` of breakpoints, follow-camera toggle. `loadTrace()` (record-replay) vs.
  `startLive()`/`appendStep()`/`endLive()` (live mode) are mutually exclusive entry points — the
  scrub/step/play controls all early-return while `isLive`. `culprit` (the last `"raise"` step index
  for a `"failed"` trace) is recomputed only when the trace/its status changes, not per tick, and the
  player (`tick()`) auto-pauses there or on a breakpoint node, same as a debugger stopping on an
  unhandled exception.
- **`canvas/TraceControls.tsx`** — the control bar: trace picker (`listTraces()`/`getTrace()`),
  step/play/speed/scrub, a reconstructed call-stack panel (`callStackAt()` replays call/return/unwind
  frames up to `stepIndex` — it's derived on the fly, not stored), an error-marker on the timeline
  per `raise`/`unwind` step, and a breakpoint toggle on the current frame's node.
- **`canvas/TraceFlowOverlay.tsx`** — the animated overlay: for the current step, draws an edge from
  caller to callee and pulses the active node; the last `TRAIL` (5) steps trail behind, fading. ⚠
  **Zoom-aware the same way `ConnectionsOverlay` is**: every step's `node_id`/`caller_node_id` is
  resolved through `expansionStore.getNearestVisibleAncestor()` before drawing, so a collapsed target
  routes flow block-to-block and an expanded one routes function-to-function — steps that collapse
  onto the same visible node become a single "pulse in place" instead of a self-loop. Error frames
  (`raise`/`unwind`, or any step with `error` set) render with the `--error` marker/class variant.
- **`canvas/RootCanvas.tsx`** wires both halves together: `subscribeTraceStream()` reacts to
  `trace-start`/`step`/`trace-end` messages by calling `traceStore.startLive`/`ensureLive` +
  `appendStep`/`endLive` — **this is what auto-enters trace mode the moment a `--stream` run begins**,
  with no manual toggle needed (`ensureLive` is the guard that lets a socket which reconnected mid-run,
  or a page opened after `trace-start` already fired, still render subsequent steps instead of
  silently dropping them). A separate effect follows the active step when `followCamera` is on:
  `revealNode()` (expands ancestors, same as any other reveal) then centers the viewport on the
  nearest **visible** ancestor of the active node, without changing zoom.
- **`engine-client/EngineClient.ts`** — `listTraces()`/`getTrace()` (plain HTTP), `subscribeTrace()`
  (rides the shared events socket for the `"trace"` ping), and `subscribeTraceStream()` — its own
  dedicated `WebSocket` to `/trace-stream`, opened lazily on first listener and closed when the last
  one unsubscribes, with a 1s backoff reconnect while listeners remain. `dispose()` tears this socket
  down too, alongside the shared events socket, when `EngineClientProvider` switches workspaces.
  `mockBridge.ts` serves canned `MOCK_TRACES` for `listTraces`/`getTrace` but never fires
  `subscribeTrace`/`subscribeTraceStream` — there is no mock live-trace demo.

## Tests

`tests/unit/test_trace_mapper.py` (qualname/locals-stripped/line-fallback/external-frame
resolution), `tests/unit/test_trace_run.py` (call/return capture, caller linking, uncaught vs.
handled exceptions under both `settrace` and `sys.monitoring`, clean-`sys.exit` handling,
`write_trace`'s on-disk shape), `tests/unit/test_bridge_trace_route.py` (`GET /traces[/{id}]`,
seq-ordering, the trace-dir watcher's `{"type": "trace"}` ping, and the `trace-ingest` →
`trace-stream` relay) · `web/src/state/traceStore.test.ts`, `web/src/canvas/TraceFlowOverlay.test.tsx`,
`web/e2e/trace-playback.spec.ts`.

## Known gaps / design deltas

- The original design doc's phase 4 ("Live (v2)") is not a gap — it shipped in this checkout
  alongside phases 1–3, not as later follow-up work.
- The design doc's stream direction was drafted as a single `WS /trace-stream`; what shipped is two
  routes (`trace-ingest` for the producer CLI, `trace-stream` for canvas consumers) relayed through
  one `ConnectionManager` — necessary because the tracer CLI and the canvas are different processes
  with no shared handle to push through otherwise.
- The `.meta.json` summary sidecar and the `--capture-args`/`--no-monitoring`/`--id` CLI flags are
  implementation additions beyond the original design, not called out in the planning doc.
- No UI to *start* a live run from the canvas — `codechroma-trace --stream` is always invoked out of
  band (a terminal, a script); the canvas only ever consumes.
- No trace deletion/retention: `.codechroma/traces/` grows unbounded; nothing prunes old runs.
