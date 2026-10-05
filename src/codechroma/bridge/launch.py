"""One-command launcher: analyze a repo with the live bridge, then boot the web canvas against it.

Usage: python -m codechroma.bridge.launch --repo-path /path/to/repo
       python -m codechroma.bridge.launch --github owner/repo [--ref BRANCH] [--clone-dir DIR]
Any VITE_* env vars (e.g. VITE_CANVAS_STRATEGY=tree) are forwarded to the frontend.
"""

from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from codechroma.bridge.github_repo import GithubRepoError, open_github_repo, parse_github_ref
from codechroma.bridge.skill_sync import SKILL_NAMES, sync_skill
from codechroma.llm.runtime_env import CliLookupError, get_runtime_environment, resolve_runtime_cli

PROJECT_ROOT = Path(__file__).resolve().parents[3]
WEB_DIR = PROJECT_ROOT / "web"


def _wait_for_port(host: str, port: int, timeout: float) -> bool:
    """Blocks until the bridge accepts connections (its startup analyze is done), or times out."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def _start_bridge(repo_path: Path, host: str, port: int) -> subprocess.Popen:
    env = get_runtime_environment().spawn_env()
    env["codechroma_BRIDGE_REPO_PATH"] = str(repo_path)
    command = [
        sys.executable, "-m", "uvicorn", "codechroma.bridge.server:app",
        "--host", host, "--port", str(port),
    ]
    return subprocess.Popen(command, cwd=str(PROJECT_ROOT), env=env)


def _start_frontend(bridge_url: str, host: str, port: int) -> subprocess.Popen:
    env = get_runtime_environment().spawn_env()
    env["VITE_ENGINE_BRIDGE_URL"] = bridge_url
    env["VITE_TERMINAL_BRIDGE_URL"] = f"ws://{host}:{port}"
    try:
        runtime = resolve_runtime_cli(
            os.environ.get("CODECHROMA_NPM") or ("npm.cmd" if os.name == "nt" else "npm"), env,
        )
    except CliLookupError as exc:
        raise FileNotFoundError("npm was not found; install Node.js or set CODECHROMA_NPM") from exc
    npm, env = runtime.executable, dict(runtime.env)
    return subprocess.Popen([npm, "run", "dev"], cwd=str(WEB_DIR), env=env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="codechroma-live", description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--repo-path", help="Path to the repository to visualize")
    source.add_argument(
        "--github", help="GitHub URL or owner/repo[@ref] to clone (or refresh) and visualize"
    )
    parser.add_argument("--ref", help="Branch, tag or commit to open with --github")
    parser.add_argument(
        "--clone-dir", help="Where --github clones to (default ~/.codechroma/github-repos/o/r)"
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bridge host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bridge port (default 8000)")
    parser.add_argument(
        "--ready-timeout", type=float, default=600.0,
        help="Max seconds to wait for the initial analyze",
    )
    args = parser.parse_args(argv)

    if args.github:
        try:
            reference = parse_github_ref(args.github, args.ref)
            print(f"[codechroma-live] opening {reference.slug} from GitHub …", flush=True)
            clone_dir = Path(args.clone_dir) if args.clone_dir else None
            repo_path = open_github_repo(reference, clone_dir)
        except GithubRepoError as exc:
            parser.error(str(exc))
    else:
        repo_path = Path(args.repo_path).expanduser().resolve()
        if not repo_path.is_dir():
            parser.error(f"--repo-path is not a directory: {repo_path}")

    for skill_name in SKILL_NAMES:
        skill_target = sync_skill(repo_path, skill_name)
        if skill_target is not None:
            print(f"[codechroma-live] installed {skill_name} skill at {skill_target}", flush=True)

    bridge_url = f"http://{args.host}:{args.port}"
    print(f"[codechroma-live] analyzing {repo_path} …", flush=True)
    bridge = _start_bridge(repo_path, args.host, args.port)
    frontend: subprocess.Popen | None = None
    try:
        if not _wait_for_port(args.host, args.port, args.ready_timeout):
            print("[codechroma-live] bridge not ready in time", file=sys.stderr, flush=True)
            return 1
        print(f"[codechroma-live] bridge ready at {bridge_url}; starting canvas …", flush=True)
        frontend = _start_frontend(bridge_url, args.host, args.port)
        return _supervise(bridge, frontend)
    except KeyboardInterrupt:
        return 0
    finally:
        _terminate(frontend)
        _terminate(bridge)


def _supervise(bridge: subprocess.Popen, frontend: subprocess.Popen) -> int:
    """Blocks until either child exits, so killing one (or Ctrl-C) tears the whole launch down."""
    while True:
        if bridge.poll() is not None:
            return bridge.returncode or 0
        if frontend.poll() is not None:
            return frontend.returncode or 0
        time.sleep(0.3)


def _terminate(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate() if os.name == "nt" else process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
