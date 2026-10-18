# ruff: noqa: E501
"""Baseline for the C# bridge migration: Python bridge cold start (spawn -> /health) and memory.

Usage: poetry run python scripts/bench_bridge_cold_start.py [repo_path] [runs]

Spawns `uvicorn codechroma.bridge.server:app` over a copy of tests/fixtures/sample_repo (or the
given repo), times process start to the first 200 from /health (which means the initial analyze is
done), then reports working-set / peak working-set of the bridge process tree's largest process of the tree (the venv launcher stub spawns the real interpreter).
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "tests" / "fixtures" / "sample_repo"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _memory_mb(pid: int) -> tuple[float, float]:
    """(current, peak) resident MB of `pid`."""
    if sys.platform == "win32":
        script = (
            f"$ids = @({pid}) + (Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq {pid}"
            " | ForEach-Object ProcessId); $best = Get-Process -Id $ids | Sort-Object PeakWorkingSet64"
            ' -Descending | Select-Object -First 1; "$($best.WorkingSet64) $($best.PeakWorkingSet64)"'
        )
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True
        ).stdout.split()
        return int(out[0]) / 1e6, int(out[1]) / 1e6
    fields = dict(
        line.split(":", 1)
        for line in Path(f"/proc/{pid}/status").read_text().splitlines()
        if ":" in line
    )
    return int(fields["VmRSS"].split()[0]) / 1e3, int(fields["VmHWM"].split()[0]) / 1e3


def _prepare_repo(target: Path) -> Path:
    shutil.copytree(SAMPLE, target)
    for args in (
        ["init"],
        ["add", "-A"],
        ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "i"],
    ):
        subprocess.run(["git", *args], cwd=target, check=True, capture_output=True)
    return target


def _one_run(repo: Path) -> dict:
    port = _free_port()
    env = {**os.environ, "codechroma_BRIDGE_REPO_PATH": str(repo), "ANTHROPIC_API_KEY": ""}
    started = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "codechroma.bridge.server:app", "--port", str(port)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=ROOT,
    )
    try:
        while time.perf_counter() - started < 120:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as reply:
                    if reply.status == 200:
                        break
            except OSError:
                time.sleep(0.05)
        cold_start = time.perf_counter() - started
        current, peak = _memory_mb(proc.pid)
        return {
            "cold_start_s": round(cold_start, 2),
            "rss_mb": round(current, 1),
            "peak_mb": round(peak, 1),
        }
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def main() -> None:
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    with tempfile.TemporaryDirectory() as tmp:
        repo = (
            Path(sys.argv[1])
            if len(sys.argv) > 1 and sys.argv[1]
            else _prepare_repo(Path(tmp) / "repo")
        )
        results = [_one_run(repo) for _ in range(runs)]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
