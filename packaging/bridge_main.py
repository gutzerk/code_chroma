"""Frozen-bridge entry point: the desktop app spawns this instead of running uvicorn in a shell."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) == 2 and arguments[0] == "--printenv":
        from codechroma.llm.env_helper import print_environment

        print_environment(arguments[1])
        return 0
    parser = argparse.ArgumentParser(prog="codechroma-bridge", description=__doc__)
    parser.add_argument("--repo-path", required=True, help="Repository to analyze")
    parser.add_argument("--port", type=int, required=True, help="Port to serve on")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default 127.0.0.1)")
    args = parser.parse_args(argv)

    repo_path = Path(args.repo_path).expanduser().resolve()
    if not repo_path.is_dir():
        parser.error(f"--repo-path is not a directory: {repo_path}")

    # Still exported: terminal/server.py falls back to this var when no workspace is bound.
    os.environ["codechroma_BRIDGE_REPO_PATH"] = str(repo_path)
    # Desktop app picks a random port per launch; codechroma-* skills read this, not localhost:8000.
    os.environ["codechroma_BRIDGE_URL"] = f"http://{args.host}:{args.port}"
    print(f"analyzing {repo_path}", flush=True)

    import uvicorn

    from codechroma.bridge.app import create_app

    # The path is passed, not inferred: create_app takes it directly, so a relative one is fine.
    app = create_app(repo_path)
    print("ready", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
