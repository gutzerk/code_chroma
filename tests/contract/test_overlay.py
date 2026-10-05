"""Contract: the overlay mechanism (037, contracts/overlay.md) -- `OverlayRecord` shape, and
`attach_overlays()`'s per-node + top-level merge onto an already-resolved diagram. Ghosts arrive
in their own `ghosts[]` array, never as an `is_ghost` flag on a shared list. The `"changes"` overlay
now resolves via a real `GraphEngine` node lookup (impact), not a path prefix (c1) -- see
docs/architecture/diagram-skills.md.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.overlays import OVERLAY_PROVIDERS, attach_overlays
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)


def _commit_all(root: Path) -> None:
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


class _FakeWs:
    """Just enough of `Workspace` for the `"changes"` overlay provider to run."""

    def __init__(self, root: Path, engine, impact_changes: dict | None = None, base: str = "HEAD"):
        self.root = root
        self.engine = engine
        self._impact_changes = impact_changes or {}
        self._base = base

    def load_impact_changes(self) -> dict:
        return self._impact_changes

    def diff_base(self) -> str:
        return self._base


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    (root / "billing.py").write_text("def charge():\n    return 1\n", encoding="utf-8")
    _commit_all(root)
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(root))
    return root, engine


def _diagram():
    return {
        "nodes": [{"id": "billing", "name": "Billing", "node_id": "component::billing.py"}],
        "relations": [],
    }


def test_the_builtin_overlays_are_registered():
    assert set(OVERLAY_PROVIDERS) >= {"changes"}


def test_a_changed_node_gets_an_overlay_record_with_no_is_ghost_field(repo):
    root, engine = repo
    (root / "billing.py").write_text("def charge():\n    return 2\n", encoding="utf-8")
    ws = _FakeWs(root, engine)

    resolved = attach_overlays(_diagram(), ws, ["changes"])

    node = next(n for n in resolved["nodes"] if n["id"] == "billing")
    record = node["overlays"]["changes"]
    assert record["status"] == "modified"
    assert "is_ghost" not in record


def test_ghosts_arrive_in_their_own_top_level_array_not_a_flag_on_nodes(repo):
    root, engine = repo
    ws = _FakeWs(
        root,
        engine,
        impact_changes={
            "ghosts": [{"id": "legacy", "parent": "billing", "name": "Legacy", "before": "x"}]
        },
    )

    resolved = attach_overlays(_diagram(), ws, ["changes"])

    assert [n["id"] for n in resolved["nodes"]] == ["billing"]
    assert "is_ghost" not in resolved["nodes"][0]
    ghost_ids = [g["id"] for g in resolved["ghosts"]]
    assert ghost_ids == ["legacy"]
    assert "is_ghost" not in resolved["ghosts"][0]
    assert resolved["ghosts"][0]["overlays"]["changes"]["parent"] == "billing"
