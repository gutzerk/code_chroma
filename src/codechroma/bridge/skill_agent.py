"""Runs a CodeChroma skill headlessly via `claude -p`, protecting the artifact it rewrites.

Authoring a diagram (or a change review of one) is a long run, so every runner snapshots its target
file before the agent starts and restores it if the run times out, exits non-zero, or leaves an
unparseable file — a half-written artifact must never replace a good one. One instance per artifact
per app: `BridgeServices` owns every runner and kills in-flight runs on shutdown.

The run is also streamed: `--output-format stream-json` makes the CLI emit one JSON event per line
as it works, each rendered to a progress line (skill_output.render_event), kept in a bounded
per-repo buffer and pushed to the canvas in batches. Without it a 600s run is a static "Generating…"
label with no way to tell working from stuck.

Debug only: setting `codechroma_SKILL_LOG_DIR` to a directory makes every run also write its raw
stdout/stderr stream to `<dir>/<name>-<repo_id>-<timestamp>.log`, unbounded and untouched by
`output_lines`'/`output_tail_chars`' truncation. Unset by default -- nothing is written to disk
otherwise, and the in-memory buffer above is still all a normal run keeps.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shutil
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, TextIO

from codechroma.config import settings
from codechroma.llm.cli_adapters import CLI_ADAPTERS, CliAdapter
from codechroma.llm.resolve_cli import resolve_cli as _resolve_cli

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

logger = logging.getLogger("codechroma.bridge.skill_agent")

OnChange = Callable[[str, dict], Awaitable[None]]
OnOutput = Callable[[str, list[str]], Awaitable[None]]
# A `run_body`-equipped SkillAgent (058) replaces the `claude -p` subprocess with this coroutine.
RunBody = Callable[["SkillAgent", "Workspace | None", str, "OnOutput | None"], Awaitable[dict]]

_IDLE_STATE = {"state": "idle", "error": None}


def _output_tail() -> int:
    return settings.skill_agent.output_tail_chars


def _output_lines() -> int:
    return settings.skill_agent.output_lines


def _flush_interval() -> float:
    return settings.skill_agent.flush_interval_seconds


def _stream_limit() -> int:
    return settings.skill_agent.stream_limit_bytes


def open_debug_log(name: str, repo_id: str) -> TextIO | None:
    """Opens a per-run raw-stream log file iff codechroma_SKILL_LOG_DIR is set -- debug only."""
    raw_dir = os.environ.get("codechroma_SKILL_LOG_DIR", "").strip()
    if not raw_dir:
        return None
    safe_repo_id = repo_id.replace("/", "_")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    try:
        log_dir = Path(raw_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        return (log_dir / f"{name}-{safe_repo_id}-{stamp}.log").open("a", encoding="utf-8")
    except OSError:
        logger.exception("%s: could not open debug log dir %s", name, raw_dir)
        return None


def debug_write(log: TextIO | None, text: str) -> None:
    """Best-effort append -- a debug log write must never break the run it's watching."""
    if log is None:
        return
    try:
        log.write(text)
        log.flush()
    except OSError:
        pass


def item_from_key(key: str) -> str:
    """The item half of a composite `{repo_id}:{item}` job key (a bare key is its own item)."""
    return key.rsplit(":", 1)[-1]


def build_skill_agent(
    kind: str,
    *,
    name: str,
    prompt: str | None = None,
    artifact: Callable[[Path, str], Path],
    validate: Callable[[object], bool],
    timeout_env_var: str,
    invalid_error: str,
    run_body: RunBody | None = None,
) -> SkillAgent:
    """One place for the settings-derived timeout/model plumbing every runner used to repeat."""
    timeouts = settings.skill_agent_timeouts
    return SkillAgent(
        name=name,
        prompt=prompt,
        model=timeouts.model,
        artifact=artifact,
        validate=validate,
        timeout_env_var=timeout_env_var,
        default_timeout_seconds=timeouts.seconds_for(kind),
        invalid_error=invalid_error,
        run_body=run_body,
    )


class SkillAgent:
    """One background `claude -p` job kind, keyed per repo id, writing whatever artifact() picks."""

    def __init__(
        self,
        *,
        name: str,
        prompt: str | None = None,
        model: str,
        artifact: Callable[[Path, str], Path],
        validate: Callable[[object], bool],
        timeout_env_var: str,
        default_timeout_seconds: int,
        invalid_error: str,
        run_body: RunBody | None = None,
    ) -> None:
        self.name = name
        self.prompt = prompt
        self.model = model
        self.artifact = artifact
        self.validate = validate
        self.timeout_env_var = timeout_env_var
        self.default_timeout_seconds = default_timeout_seconds
        self.invalid_error = invalid_error
        # 058: when set, replaces the generic claude -p subprocess with this coroutine entirely.
        self.run_body = run_body
        # Public so the modules wrapping an instance can alias them for tests that reset job state.
        self.jobs: dict[str, dict] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self.procs: dict[str, asyncio.subprocess.Process] = {}
        # A run_body's own worker-pool subprocesses -- several per repo_id, unlike self.procs above.
        self.job_procs: dict[str, set[asyncio.subprocess.Process]] = {}
        self.output: dict[str, deque[str]] = {}

    def get_state(self, repo_id: str) -> dict:
        """Current job state for repo_id, defaulting to idle if nothing's ever run."""
        return dict(self.jobs.get(repo_id, _IDLE_STATE))

    def get_output(self, repo_id: str) -> list[str]:
        """The run's progress lines so far — kept after it ends, so a late panel still sees them."""
        return list(self.output.get(repo_id, ()))

    async def start(
        self,
        repo_id: str,
        repo_root: Path,
        on_change: OnChange,
        on_output: OnOutput | None = None,
        prompt: str | None = None,
        workspace: Workspace | None = None,
    ) -> dict:
        """Starts a background run unless one's in flight; `workspace` is only for `run_body`."""
        already = self._already_generating(repo_id)
        if already is not None:
            return already

        cli = self.resolve_cli()
        if shutil.which(cli[1]) is None:
            state = {"state": "error", "error": f"{cli[1]} CLI not found on PATH"}
            self.jobs[repo_id] = state
            await on_change(repo_id, state)
            return dict(state)

        state = await self._begin_generating(repo_id, on_change)
        task = asyncio.create_task(
            self._run(repo_id, repo_root, on_change, on_output, prompt, cli, workspace)
        )
        self.tasks[repo_id] = task
        # 🔴 Self-removing: cancel() awaits what is left, and a closed-loop task raises there.
        task.add_done_callback(lambda done: self._forget_task(repo_id, done))
        return dict(state)

    def _forget_task(self, repo_id: str, task: asyncio.Task) -> None:
        """Drops a finished task, unless a newer run for the same repo already replaced it."""
        if self.tasks.get(repo_id) is task:
            self.tasks.pop(repo_id, None)

    def timeout_seconds(self) -> int:
        """Read per run, so a slow deep run can be given more room without a code change."""
        raw = os.environ.get(self.timeout_env_var, "").strip()
        return int(raw) if raw.isdigit() and int(raw) > 0 else self.default_timeout_seconds

    def register_job_proc(self, repo_id: str, proc: asyncio.subprocess.Process) -> None:
        """A run_body worker registers its own subprocess so stop()/cancel() can reach it too."""
        self.job_procs.setdefault(repo_id, set()).add(proc)

    def unregister_job_proc(self, repo_id: str, proc: asyncio.subprocess.Process) -> None:
        self.job_procs.get(repo_id, set()).discard(proc)

    async def _kill_job_procs(self, repo_id: str) -> None:
        """Kills and reaps every run_body worker subprocess still registered for repo_id."""
        procs = self.job_procs.pop(repo_id, set())
        for proc in procs:
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
        await asyncio.gather(*(proc.wait() for proc in procs), return_exceptions=True)

    async def _cancel_job(self, repo_id: str) -> asyncio.Task | None:
        """Kills repo_id's process(es) if still running and cancels its task; returns the task."""
        proc = self.procs.pop(repo_id, None)
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        await self._kill_job_procs(repo_id)
        task = self.tasks.pop(repo_id, None)
        if task is not None and not task.done():
            task.cancel()
        return task

    async def stop(self, repo_id: str) -> dict:
        """Kills repo_id's run (restoring its pre-run artifact) and resets the job to idle."""
        task = await self._cancel_job(repo_id)
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
        self.jobs[repo_id] = {"state": "idle", "error": None}
        return dict(self.jobs[repo_id])

    def _already_generating(self, repo_id: str) -> dict | None:
        """start()/mark_generating()'s shared guard: repo_id's state, if it's already generating."""
        current = self.jobs.get(repo_id)
        return dict(current) if current is not None and current["state"] == "generating" else None

    async def _begin_generating(self, repo_id: str, on_change: OnChange) -> dict:
        """Flips repo_id to generating, resets its output -- shared by start()/mark_generating."""
        state = {"state": "generating", "error": None}
        self.jobs[repo_id] = state
        self.output[repo_id] = deque(maxlen=_output_lines())
        await on_change(repo_id, state)
        return dict(state)

    async def mark_generating(self, repo_id: str, on_change: OnChange) -> dict:
        """start()'s interactive-run counterpart: same generating flip, no subprocess spawned."""
        already = self._already_generating(repo_id)
        return already if already is not None else await self._begin_generating(repo_id, on_change)

    async def mark_done(self, repo_id: str, on_change: OnChange, error: str | None = None) -> dict:
        """stop()'s interactive-run counterpart: same idle/error flip, no process to kill."""
        state = {"state": "error", "error": error} if error is not None else dict(_IDLE_STATE)
        self.jobs[repo_id] = state
        await on_change(repo_id, state)
        return dict(state)

    async def cancel(self) -> None:
        """Kills this runner's in-flight processes and awaits their tasks."""
        repo_ids = list(set(self.procs) | set(self.job_procs) | set(self.tasks))
        tasks = [await self._cancel_job(repo_id) for repo_id in repo_ids]
        # Done tasks are skipped: nothing left to await, and one from a closed loop would raise.
        pending = [task for task in tasks if task is not None and not task.done()]
        await asyncio.gather(*pending, return_exceptions=True)

    async def forget(self, repo_id: str) -> None:
        """Cancels and drops all of repo_id's state, including composite `{repo_id}:*` job keys."""
        # Epic-brief/custom key jobs per item; unmatched, those entries leak forever.
        prefix = f"{repo_id}:"
        keys = {
            key
            for key in set(self.jobs) | set(self.tasks) | set(self.procs)
            | set(self.job_procs) | set(self.output)
            if key == repo_id or key.startswith(prefix)
        }
        for key in keys:
            task = await self._cancel_job(key)
            if task is not None:
                await asyncio.gather(task, return_exceptions=True)
            self.jobs.pop(key, None)
            self.output.pop(key, None)

    async def _run(
        self,
        repo_id: str,
        repo_root: Path,
        on_change: OnChange,
        on_output: OnOutput | None = None,
        prompt: str | None = None,
        cli: tuple[CliAdapter, str, str, dict[str, str]] | None = None,
        workspace: Workspace | None = None,
    ) -> None:
        try:
            if self.run_body is not None:
                state = await self._run_pipeline_body(repo_id, repo_root, workspace, on_output)
            else:
                state = await self._run_cli(repo_id, repo_root, on_output, prompt, cli)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("%s: run crashed for %s", self.name, repo_id)
            state = {"state": "error", "error": "generation crashed unexpectedly"}
        self.jobs[repo_id] = state
        await on_change(repo_id, state)

    async def _run_pipeline_body(
        self,
        repo_id: str,
        repo_root: Path,
        workspace: Workspace | None,
        on_output: OnOutput | None,
    ) -> dict:
        """`run_body`'s counterpart of `_run_cli`: same snapshot/timeout/restore/validate shape."""
        assert self.run_body is not None
        snapshot = self._snapshot(repo_root, repo_id)

        def restore() -> None:
            self._restore(repo_root, repo_id, snapshot)

        try:
            result = await asyncio.wait_for(
                self.run_body(self, workspace, repo_id, on_output), timeout=self.timeout_seconds()
            )
        except asyncio.CancelledError:
            await self._kill_job_procs(repo_id)
            restore()
            raise
        except TimeoutError:
            await self._kill_job_procs(repo_id)
            restore()
            return {"state": "error", "error": "generation timed out"}

        if result.get("state") != "idle":
            restore()
            return result
        if not self.has_artifact(repo_root, repo_id):
            restore()
            return {"state": "error", "error": self.invalid_error}
        return result

    def resolve_cli(self) -> tuple[CliAdapter, str, str, dict[str, str]]:
        """(adapter, binary, model, env_overrides) of the shared resolve, adapter mapped to impl."""
        adapter_key, binary, model, env_overrides = _resolve_cli(self.name, self.model)
        return CLI_ADAPTERS[adapter_key], binary, model, env_overrides

    async def _run_cli(
        self,
        repo_id: str,
        repo_root: Path,
        on_output: OnOutput | None = None,
        prompt: str | None = None,
        cli: tuple[CliAdapter, str, str, dict[str, str]] | None = None,
    ) -> dict:
        snapshot = self._snapshot(repo_root, repo_id)

        def restore() -> None:
            self._restore(repo_root, repo_id, snapshot)

        adapter, binary, model, env_overrides = cli if cli is not None else self.resolve_cli()
        static_prompt = prompt if prompt is not None else self.prompt
        assert static_prompt is not None, "_run_cli needs a prompt; unreachable if run_body is set"
        # An explicit --model re-triggers the CLI rejection; omit when ANTHROPIC_MODEL carries it.
        argv_model = "" if "ANTHROPIC_MODEL" in env_overrides else model
        # The run's workspace id (e.g. "pr-29"): which /repos/{id} slices and worktree to use.
        run_env = {**os.environ, **env_overrides, "codechroma_WORKSPACE_ID": repo_id}
        # build_argv's --bare check needs this run's actual env, not the bridge process's own.
        argv = adapter.build_argv(binary, static_prompt, argv_model, env=run_env)
        debug_log = open_debug_log(self.name, repo_id)
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(repo_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=_stream_limit(),
                env=run_env,
            )
        except BaseException:
            # A launch failure (missing binary, FD exhaustion) would otherwise leak this handle.
            if debug_log is not None:
                debug_log.close()
            raise
        self.procs[repo_id] = proc
        stderr_tail = bytearray()
        pending: list[str] = []
        readers = [
            asyncio.create_task(
                self._read_events(proc.stdout, repo_id, repo_root, pending, adapter, debug_log)
            ),
            asyncio.create_task(_read_tail(proc.stderr, stderr_tail, debug_log)),
        ]
        flusher = asyncio.create_task(_flush_loop(repo_id, pending, on_output))
        try:
            await asyncio.wait_for(
                asyncio.gather(*readers, proc.wait()), timeout=self.timeout_seconds()
            )
        except asyncio.CancelledError:
            # stop()/cancel() kill before cancelling; this covers a cancel with the proc alive.
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            # Restore the pre-run snapshot so a cancelled run never leaves a half-written artifact.
            restore()
            raise
        except TimeoutError:
            proc.kill()
            await proc.wait()
            restore()
            return {"state": "error", "error": "generation timed out"}
        finally:
            self.procs.pop(repo_id, None)
            for reader in readers:
                reader.cancel()
            flusher.cancel()
            # Awaited so an in-flight _flush_once unwinds before the explicit flush below runs.
            await asyncio.gather(flusher, return_exceptions=True)
            # A final flush, so the last lines (and the run's own "done" line) always land.
            await _flush_once(repo_id, pending, on_output)
            if debug_log is not None:
                debug_log.close()

        if proc.returncode != 0:
            restore()
            rendered = self.get_output(repo_id)
            message = _failure_message(proc.returncode, bytes(stderr_tail), rendered)
            return {"state": "error", "error": message}

        if not self.has_artifact(repo_root, repo_id):
            restore()
            return {"state": "error", "error": self.invalid_error}

        return {"state": "idle", "error": None}

    async def _read_events(
        self,
        stream: asyncio.StreamReader | None,
        repo_id: str,
        repo_root: Path,
        pending: list[str],
        adapter: CliAdapter,
        debug_log: TextIO | None = None,
    ) -> None:
        """Renders each output line via the adapter into the buffer; a bad line is never fatal."""
        if stream is None:
            return
        buffer = self.output.setdefault(repo_id, deque(maxlen=_output_lines()))
        while True:
            try:
                raw = await stream.readline()
            except ValueError:
                # Over the stream limit -- a tool result that large is not worth rendering.
                continue
            if not raw:
                return
            # Raw (undecoded-adapter) JSON line, unbounded -- the debug log's whole point.
            debug_write(debug_log, raw.decode(errors="replace"))
            lines = adapter.parse_line(raw, repo_root)
            buffer.extend(lines)
            pending.extend(lines)

    def _snapshot(self, repo_root: Path, repo_id: str) -> bytes | None:
        """Kept in memory, not a .bak file, so a failed run leaves nothing behind in the repo."""
        try:
            return self.artifact(repo_root, repo_id).read_bytes()
        except OSError:
            return None

    def _restore(self, repo_root: Path, repo_id: str, snapshot: bytes | None) -> None:
        path = self.artifact(repo_root, repo_id)
        # 🔴 Nothing existed before, so "restore" deletes: else a failed first run stays on disk.
        if snapshot is None:
            path.unlink(missing_ok=True)
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(snapshot)
        except OSError:
            logger.exception("%s: could not restore the previous artifact at %s", self.name, path)

    def has_artifact(self, repo_root: Path, repo_id: str) -> bool:
        """Whether a valid artifact already exists — the shared `only_if_missing` guard."""
        try:
            data = json.loads(self.artifact(repo_root, repo_id).read_text())
        except (OSError, ValueError):
            return False
        return self.validate(data)


async def _read_tail(
    stream: asyncio.StreamReader | None, tail: bytearray, debug_log: TextIO | None = None
) -> None:
    """Keeps only the last _output_tail() bytes of stderr — all _failure_message ever reports."""
    if stream is None:
        return
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            return
        tail.extend(chunk)
        del tail[:-_output_tail()]
        debug_write(debug_log, chunk.decode(errors="replace"))


async def _flush_loop(repo_id: str, pending: list[str], on_output: OnOutput | None) -> None:
    while True:
        await asyncio.sleep(_flush_interval())
        await _flush_once(repo_id, pending, on_output)


async def _flush_once(repo_id: str, pending: list[str], on_output: OnOutput | None) -> None:
    """Hands off whatever accumulated since the last tick; never lets a push break the run."""
    if not pending:
        return
    if on_output is None:
        pending[:] = []
        return
    # Cleared only after delivery finishes, so a cancellation mid-await leaves it queued for retry.
    batch = list(pending)
    try:
        await on_output(repo_id, batch)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("skill_agent: could not push progress for %s", repo_id)
        del pending[: len(batch)]
    else:
        del pending[: len(batch)]


def _failure_message(returncode: int | None, stderr: bytes, rendered: list[str]) -> str:
    """The adapter's own ✗/↳ error line beats stderr noise, which beats the raw exit code."""
    error_line = next(
        (line for line in reversed(rendered) if line.startswith(("✗ ", "  ↳ error: "))), None
    )
    if error_line:
        return error_line
    message = stderr.decode(errors="replace").strip()
    if message:
        return message
    tail = "\n".join(rendered[-3:]).strip()
    return tail or f"claude exited {returncode}"
