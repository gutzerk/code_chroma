"""One zero-tool `claude -p` subprocess per wiki-general pipeline job, with bounded retries.

058-wiki-general-deterministic-fanout's fix for the "the model became its own workflow planner"
failure: each worker call is a single, self-contained unit of work (one component page, one
container page, the undetermined-files batch, or the system narrative), given exactly one prompt and
a JSON schema to answer against -- no tools, no sub-agents, no chance to recurse into the skill that
started it. `run_worker_job` retries a transient failure up to `max_retries_per_job` times before
giving up; `wiki_general_pipeline.py` is the only caller.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from codechroma.bridge.skill_agent import SkillAgent, debug_write, open_debug_log
from codechroma.config import settings
from codechroma.llm.cli_adapters import CliAdapter, supports_minimal_context_workers

logger = logging.getLogger("codechroma.bridge.wiki_general_worker")


class UnsupportedAdapterError(Exception):
    """Raised once, up front, when the selected CLI adapter has no minimal-context worker mode."""


@dataclass
class WorkerResult:
    ok: bool
    data: dict | None
    error: str | None


def require_minimal_context_support(adapter: CliAdapter, binary: str) -> None:
    """058's explicit fail-clearly gate -- never a silent fallback to a full-context call."""
    if not supports_minimal_context_workers(adapter):
        raise UnsupportedAdapterError(
            f"adapter {binary!r} does not support minimal-context workers"
        )


async def run_worker_job(
    agent: SkillAgent,
    repo_id: str,
    repo_root: Path,
    adapter: CliAdapter,
    binary: str,
    model: str,
    prompt: str,
    schema: dict,
    env_overrides: dict[str, str],
    job_label: str = "job",
) -> WorkerResult:
    """Runs one worker job, retrying up to `max_retries_per_job` times on any failure."""
    cfg = settings.wiki_general_pipeline
    result = WorkerResult(False, None, "worker never ran")
    # One file for the whole job -- every retry attempt appends to it, not a fresh file each time.
    debug_log = open_debug_log(agent.name, f"{repo_id}:{job_label}")
    try:
        for attempt in range(cfg.max_retries_per_job + 1):
            result = await _run_once(
                agent, repo_id, repo_root, adapter, binary, model, prompt, schema,
                cfg.job_timeout_seconds, job_label, attempt, debug_log, env_overrides,
            )
            if result.ok:
                return result
        return result
    finally:
        if debug_log is not None:
            debug_log.close()


async def _run_once(
    agent: SkillAgent,
    repo_id: str,
    repo_root: Path,
    adapter: CliAdapter,
    binary: str,
    model: str,
    prompt: str,
    schema: dict,
    timeout_seconds: int,
    job_label: str,
    attempt: int,
    debug_log: TextIO | None,
    env_overrides: dict[str, str],
) -> WorkerResult:
    """One subprocess attempt; its raw stdout/stderr are appended to the job's shared debug log."""
    argv = adapter.build_worker_argv(binary, prompt, model, schema)
    debug_write(debug_log, f"=== attempt {attempt + 1}: {' '.join(argv)}\n")
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(repo_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, **env_overrides},
    )
    agent.register_job_proc(repo_id, proc)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        debug_write(debug_log, "=== timed out\n")
        return WorkerResult(False, None, "worker timed out")
    except asyncio.CancelledError:
        # An outer cancel: pipeline timeout, or _kill_job_procs already killing+reaping it.
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    finally:
        agent.unregister_job_proc(repo_id, proc)

    debug_write(debug_log, stdout.decode(errors="replace"))
    debug_write(debug_log, stderr.decode(errors="replace"))

    if proc.returncode != 0:
        # stdout's own readable `result` beats stderr noise (e.g. an unrelated cosmetic warning).
        parse_error = getattr(adapter, "parse_error_message", None)
        api_message = parse_error(stdout) if parse_error is not None else None
        message = (
            api_message
            or stderr.decode(errors="replace").strip()
            or f"worker exited {proc.returncode}"
        )
        logger.warning("%s: worker job failed for %s: %s", agent.name, repo_id, message)
        return WorkerResult(False, None, message)

    data = adapter.parse_structured_output(stdout)
    if data is None:
        return WorkerResult(False, None, "worker returned no structured output")
    return WorkerResult(True, data, None)
