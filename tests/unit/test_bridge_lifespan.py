"""Importing the bridge must analyze nothing; only `create_app` may.

This is the guard on the regression the app factory exists to fix: `bridge/server.py` used to
analyze a repository at module scope, so every route test had to `importlib.reload` it and pay a
full analyze to point it somewhere else.
"""

import subprocess
import sys
from pathlib import Path

from codechroma.bridge.app import create_app

_IMPORT_ONLY = """
import os, sys
from pathlib import Path
os.environ["codechroma_BRIDGE_REPO_PATH"] = sys.argv[1]
os.environ["ANTHROPIC_API_KEY"] = ""
import codechroma.bridge.app  # noqa: F401
print("imported")
"""


def _graph_db(repo: Path) -> Path:
    return repo / ".codechroma" / "graph.db"


def test_importing_the_app_module_analyzes_no_repository(bridge_repo):
    result = subprocess.run(
        [sys.executable, "-c", _IMPORT_ONLY, str(bridge_repo)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "imported" in result.stdout
    assert not _graph_db(bridge_repo).exists()


def test_create_app_is_what_analyzes(bridge_repo, make_bridge):
    make_bridge(bridge_repo)

    assert _graph_db(bridge_repo).exists()


def test_create_app_defaults_to_the_env_var_when_given_no_root(bridge_repo, monkeypatch):
    monkeypatch.setenv("codechroma_BRIDGE_REPO_PATH", str(bridge_repo))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    app = create_app()

    assert app.state.services.repo_root == bridge_repo
