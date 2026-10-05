"""Shared fixtures for the bridge route tests: one temporary git repo, one app built over it.

Every bridge route test used to carry its own copy of `_init_repo` and a fixture that reloaded
`codechroma.bridge.server` so the module-scope analyze would re-run against a new
`codechroma_BRIDGE_REPO_PATH`. `create_app(repo)` replaced both, and `BridgeHarness` keeps the old
`server.<global>` spellings working so the tests read the same as they did.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from codechroma.bridge.app import create_app
from codechroma.bridge.prs.manager import PrRecord
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import Workspace

FIXTURE_REPO = Path(__file__).parent / "fixtures" / "sample_repo"


@pytest.fixture
def use_test_runtime(monkeypatch):
    """Capture the test's current PATH without a real login shell or another test's cache."""
    import os

    from codechroma.llm import runtime_env
    from codechroma.llm.runtime_settings import RuntimeSettings

    def use():
        monkeypatch.setattr(runtime_env, "_probe", lambda *_: ({}, None, (), "test-shell"))
        runtime = runtime_env.RuntimeEnvironment(RuntimeSettings(), dict(os.environ))
        runtime.snapshot()
        monkeypatch.setattr(runtime_env, "get_runtime_environment", lambda: runtime)
        return runtime

    return use


def init_repo(root: Path) -> None:
    """`git init` + one commit of everything, the starting point every bridge test assumes."""
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def copy_sample_repo(target: Path) -> Path:
    """A committed copy of tests/fixtures/sample_repo at `target`."""
    shutil.copytree(FIXTURE_REPO, target)
    init_repo(target)
    return target


def diagram_json_path(repo: Path, kind: str) -> Path:
    """`<repo>/.codechroma/diagrams/<kind>/<basename>.json`, matching the production path scheme."""
    basename = kind.rsplit("/", 1)[-1]
    return repo.joinpath(".codechroma", "diagrams", *kind.split("/"), f"{basename}.json")


def pr_record(
    number: int, worktree: str = "/pr/worktree", head_sha: str = "deadbeef", base_ref: str = "main"
) -> PrRecord:
    """A minimal PR record for agent/PR-attach tests -- no real git state required by the caller."""
    return PrRecord(
        number=number,
        title="fix",
        url="",
        head_ref="feature",
        head_sha=head_sha,
        base_ref=base_ref,
        worktree=worktree,
        imported_at="2026-01-01T00:00:00Z",
        fetched_at="2026-01-01T00:00:00Z",
    )


@dataclass
class BridgeHarness:
    """An app over one repo, plus the accessors the tests used to reach as `server.<global>`."""

    app: FastAPI
    repo: Path

    @property
    def services(self) -> BridgeServices:
        return self.app.state.services

    @property
    def registry(self):
        return self.services.registry

    @property
    def agent_manager(self):
        return self.services.agent_manager

    @property
    def pr_manager(self):
        return self.services.pr_manager

    @property
    def agent_sessions(self):
        return self.services.agent_sessions

    @property
    def connections(self):
        return self.services.connections

    @property
    def main(self) -> Workspace:
        return self.registry.main

    # The watcher handles server.py used to alias; they all belong to the main workspace.

    @property
    def watcher(self):
        return self.main._watchers.repo_watcher

    @property
    def trace_watcher(self):
        return self.main._watchers.trace_watcher

    @property
    def diagram_watchers(self) -> dict:
        return self.main._watchers.diagram_watchers

    # Route-level helpers the tests used to call as module functions on server.py.

    def workspace_cwd(self, workspace_id: str) -> str | None:
        return self.services.workspace_cwd(workspace_id)

    def pr_comments(self, repo_id: str) -> tuple[list[dict], list[dict]]:
        from codechroma.bridge.routes.diagrams import _pr_comments

        return _pr_comments(self.services, repo_id)

    def list_prs(self) -> dict:
        from codechroma.bridge.routes.prs import list_prs

        return list_prs(self.services)


@pytest.fixture
def make_repo(tmp_path):
    """A committed copy of the sample repo, with `prepare(repo)` run before the first commit."""

    def _make(prepare=None, name: str = "repo") -> Path:
        repo = tmp_path / name
        shutil.copytree(FIXTURE_REPO, repo)
        if prepare is not None:
            prepare(repo)
        init_repo(repo)
        return repo

    return _make


@pytest.fixture
def bridge_repo(make_repo) -> Path:
    """A committed copy of the sample repo; the default target for `make_bridge`."""
    return make_repo()


@pytest.fixture
def make_bridge(monkeypatch):
    """Builds a BridgeHarness over any repo — no reload, no codechroma_BRIDGE_REPO_PATH."""
    # Set, not deleted, so a real .env's key can't leak into a bootstrap Claude call.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    def _make(repo: Path) -> BridgeHarness:
        return BridgeHarness(app=create_app(repo), repo=repo)

    return _make


@pytest.fixture
def bridge(make_bridge, bridge_repo) -> BridgeHarness:
    """The common case: one app over one freshly committed copy of the sample repo."""
    return make_bridge(bridge_repo)


@pytest.fixture(scope="module")
def shared_bridge(tmp_path_factory) -> BridgeHarness:
    """One app+repo for a whole module -- only for modules whose tests never mutate either."""
    # Only safe because create_app made the app an object; a mutating test here leaks sideways.
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("ANTHROPIC_API_KEY", "")
        repo = copy_sample_repo(tmp_path_factory.mktemp("shared") / "repo")
        yield BridgeHarness(app=create_app(repo), repo=repo)


@pytest.fixture(scope="module")
def shared_client(shared_bridge) -> TestClient:
    """A TestClient over `shared_bridge`, for read-only route tests."""
    return TestClient(shared_bridge.app)
