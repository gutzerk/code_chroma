"""CLI: run a scenario under the tracer and write a replayable trace to <repo>/.codechroma/traces.

Usage: python -m codechroma.trace.run --repo-path /path/to/repo --cmd "import pkg; pkg.main()"
The --cmd is Python source executed in-process so sys.monitoring sees the repo's frames.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.io import write_json
from codechroma.summarize.ai_summarizer import AISummarizer
from codechroma.trace.mapper import FrameMapper
from codechroma.trace.models import Trace
from codechroma.trace.tracer import Tracer


def record_trace(
    repo_path: Path,
    cmd: str,
    trace_id: str | None = None,
    capture_args: bool = False,
    use_monitoring: bool = True,
    on_step=None,
) -> Trace:
    """Analyzes the repo, runs `cmd` under the tracer, and returns the captured Trace."""
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo_path))
    mapper = FrameMapper(engine, repo_path)
    del engine  # mapper copied out the indexes it needs; free the graph before the traced run
    tracer = Tracer(
        mapper,
        capture_args=capture_args,
        use_monitoring=use_monitoring,
        on_step=on_step,
    )

    trace = Trace(
        id=trace_id or uuid.uuid4().hex[:16],
        entry=cmd,
        created_at=datetime.now(UTC).isoformat(),
    )

    inserted_path = str(repo_path)
    sys.path.insert(0, inserted_path)
    modules_before = set(sys.modules)
    namespace: dict = {"__name__": "__codechroma_trace__"}
    tracer.start()
    try:
        exec(compile(cmd, "<codechroma-trace-cmd>", "exec"), namespace)
    except SystemExit as exc:
        # A clean exit (sys.exit() / sys.exit(0)) is a successful run, not a failure.
        if exc.code not in (0, None):
            tracer.status = "failed"
    except KeyboardInterrupt:
        pass
    except BaseException:
        tracer.status = "failed"
    finally:
        tracer.stop()
        if sys.path and sys.path[0] == inserted_path:
            sys.path.pop(0)
        for name in set(sys.modules) - modules_before:
            sys.modules.pop(name, None)

    trace.steps = tracer.steps
    trace.status = tracer.status  # type: ignore[assignment]
    return trace


def write_trace(repo_path: Path, trace: Trace) -> Path:
    """Persists the trace as <id>.json plus an <id>.meta.json summary sidecar; returns the path."""
    traces_dir = repo_path / ".codechroma" / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    out_path = traces_dir / f"{trace.id}.json"
    write_json(out_path, trace.to_dict())
    # Lets the bridge list traces without parsing every step array (server._trace_summary).
    write_json(traces_dir / f"{trace.id}.meta.json", trace.summary())
    return out_path


class _StreamPublisher:
    """Sends each captured step to the bridge's trace-ingest socket for live canvas playback."""

    def __init__(self, bridge_url: str, repo_id: str, trace_id: str):
        try:
            from websockets.sync.client import connect
        except ImportError as exc:
            raise SystemExit(
                "--stream needs the 'websockets' package: pip install websockets"
            ) from exc

        ws_url = bridge_url.replace("http://", "ws://").replace("https://", "wss://").rstrip("/")
        self._socket = connect(f"{ws_url}/repos/{repo_id}/trace-ingest")
        self._trace_id = trace_id
        self._socket.send(json.dumps({"type": "trace-start", "trace_id": trace_id}))

    def on_step(self, step) -> None:
        message = {"type": "step", "trace_id": self._trace_id, "step": step.to_dict()}
        try:
            self._socket.send(json.dumps(message))
        except Exception:
            pass

    def finish(self, status: str) -> None:
        try:
            self._socket.send(
                json.dumps({"type": "trace-end", "trace_id": self._trace_id, "status": status})
            )
            self._socket.close()
        except Exception:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="codechroma-trace", description=__doc__)
    parser.add_argument("--repo-path", required=True, help="Path to the repo to trace against")
    parser.add_argument("--cmd", required=True, help="Python source to run under the tracer")
    parser.add_argument("--id", default=None, help="Trace id (default: random)")
    parser.add_argument(
        "--capture-args", action="store_true",
        help="Record a truncated repr of each call's locals (off by default; data-leak risk)",
    )
    parser.add_argument(
        "--no-monitoring", action="store_true",
        help="Use sys.settrace instead of sys.monitoring",
    )
    parser.add_argument(
        "--stream", metavar="BRIDGE_URL", default=None,
        help="Also push steps live to a running bridge, e.g. http://127.0.0.1:8000",
    )
    parser.add_argument("--repo-id", default="default", help="Repo id used in the stream WS path")
    args = parser.parse_args(argv)

    repo_path = Path(args.repo_path).expanduser().resolve()
    if not repo_path.is_dir():
        parser.error(f"--repo-path is not a directory: {repo_path}")

    trace_id = args.id or uuid.uuid4().hex[:16]
    publisher = None
    on_step = None
    if args.stream:
        publisher = _StreamPublisher(args.stream, args.repo_id, trace_id)
        on_step = publisher.on_step

    trace = record_trace(
        repo_path,
        args.cmd,
        trace_id=trace_id,
        capture_args=args.capture_args,
        use_monitoring=not args.no_monitoring,
        on_step=on_step,
    )
    if publisher is not None:
        publisher.finish(trace.status)
    out_path = write_trace(repo_path, trace)
    print(
        f"[codechroma-trace] wrote {len(trace.steps)} step(s) "
        f"(status={trace.status}) to {out_path}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
