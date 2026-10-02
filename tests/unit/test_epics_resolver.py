"""epics_resolver.external_watch_paths: which sources need an out-of-repo DirWatcher (D-08)."""

from __future__ import annotations

from codechroma.bridge import epics_resolver
from codechroma.config import RequirementsConfig, Settings


def test_default_config_needs_no_external_watcher(tmp_path, monkeypatch):
    monkeypatch.setattr(epics_resolver, "settings", Settings())

    paths = epics_resolver.external_watch_paths(tmp_path)

    assert paths == []


def test_an_absolute_source_outside_root_is_reported(tmp_path, monkeypatch):
    external = tmp_path / "elsewhere"
    external.mkdir()
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    monkeypatch.setattr(
        epics_resolver,
        "settings",
        Settings(
            requirements=RequirementsConfig(
                requirements_source_uri=f"file://{external}", delivery_source_uri="file://specs"
            )
        ),
    )

    paths = epics_resolver.external_watch_paths(repo_root)

    assert external.resolve() in paths
