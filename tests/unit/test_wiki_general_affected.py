"""find_affected_components() and _diff_manifest()'s Update state-machine delta."""

import json
from dataclasses import dataclass
from pathlib import Path

from codechroma.bridge.wiki_general_agent import _diff_manifest, find_affected_components
from codechroma.dependencies.clustering import ClusterResult, ComponentCluster, ContainerCluster


@dataclass
class _FakeWorkspace:
    root: Path
    id: str = "default"


def _write_tree(root: Path, components: list[dict], pages: dict[str, str]) -> None:
    directory = root / ".codechroma" / "wiki-general"
    (directory / "c3").mkdir(parents=True, exist_ok=True)
    manifest = {"containers": [{"id": "backend", "name": "Backend"}], "components": components}
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for component_id, text in pages.items():
        (directory / "c3" / f"{component_id}.md").write_text(text, encoding="utf-8")


def test_a_changed_path_matches_the_component_whose_page_references_it(tmp_path):
    _write_tree(
        tmp_path,
        [{"id": "auth", "name": "Authentication", "container": "backend"}],
        {"auth": "# Authentication\n\n## Elements\n\n- **Login** — x.\n  - File: `src/auth.py`\n"},
    )
    ws = _FakeWorkspace(tmp_path)

    result = find_affected_components(ws, {"src/auth.py"})

    assert result["affected"] == [
        {
            "id": "auth",
            "name": "Authentication",
            "container": "backend",
            "changed_paths": ["src/auth.py"],
        }
    ]
    assert result["gaps"] == []


def test_a_changed_path_matching_no_page_lands_in_gaps(tmp_path):
    _write_tree(
        tmp_path,
        [{"id": "auth", "name": "Authentication", "container": "backend"}],
        {"auth": "# Authentication\n\n## Elements\n\n- **Login** — x.\n  - File: `src/auth.py`\n"},
    )
    ws = _FakeWorkspace(tmp_path)

    result = find_affected_components(ws, {"src/new_thing.py"})

    assert result["affected"] == []
    assert result["gaps"] == ["src/new_thing.py"]


def test_a_symbol_suffixed_reference_still_matches_its_bare_path(tmp_path):
    page = "# Authentication\n\n## Elements\n\n- **Login** — x.\n  - Class: `src/auth.py::L`\n"
    _write_tree(
        tmp_path, [{"id": "auth", "name": "Authentication", "container": "backend"}], {"auth": page}
    )
    ws = _FakeWorkspace(tmp_path)

    result = find_affected_components(ws, {"src/auth.py"})

    assert result["affected"][0]["id"] == "auth"


def test_a_component_with_no_page_on_disk_is_silently_skipped_not_crashed(tmp_path):
    _write_tree(
        tmp_path,
        [{"id": "auth", "name": "Authentication", "container": "backend"}],
        {},
    )
    ws = _FakeWorkspace(tmp_path)

    result = find_affected_components(ws, {"src/auth.py"})

    assert result == {"affected": [], "gaps": ["src/auth.py"]}


def test_a_component_id_with_a_path_separator_never_escapes_the_c3_directory(tmp_path):
    """Manifest ids are model-written; a "../../secret" id must not read outside c3/."""
    secret = tmp_path / "secret.md"
    secret.write_text("- File: `src/auth.py`\n", encoding="utf-8")
    _write_tree(
        tmp_path,
        [{"id": "../../secret", "name": "Escape", "container": "backend"}],
        {},
    )
    ws = _FakeWorkspace(tmp_path)

    result = find_affected_components(ws, {"src/auth.py"})

    assert result == {"affected": [], "gaps": ["src/auth.py"]}


def test_a_file_moved_between_components_marks_both_old_and_new_component_rewritten():
    # billing keeps 2 untouched files so the vote isn't a 1-1 tie with auth's remaining file.
    old_manifest = {
        "containers": [
            {"id": "backend", "name": "Backend", "files": ["a.py", "b.py", "c.py", "e.py"]}
        ],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py", "b.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["c.py", "e.py"]},
        ],
        "edges": [],
    }
    # b.py moves from auth into billing
    fresh = ClusterResult(
        components=[
            ComponentCluster(id="g0", container_id="c0", files=["a.py"]),
            ComponentCluster(id="g1", container_id="c0", files=["b.py", "c.py", "e.py"]),
        ],
        containers=[ContainerCluster(id="c0", component_ids=["g0", "g1"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    rewritten_ids = {entry["id"] for entry in delta["components"]["rewritten"]}
    assert rewritten_ids == {"auth", "billing"}
    assert delta["components"]["deleted"] == []
    assert delta["components"]["created"] == []


def test_an_emptied_component_is_marked_deleted():
    old_manifest = {
        "containers": [{"id": "backend", "name": "Backend", "files": ["a.py", "b.py"]}],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["b.py"]},
        ],
        "edges": [],
    }
    # billing's file b.py is deleted from the repo entirely; auth is untouched
    fresh = ClusterResult(
        components=[ComponentCluster(id="g0", container_id="c0", files=["a.py"])],
        containers=[ContainerCluster(id="c0", component_ids=["g0"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    assert delta["components"]["deleted"] == ["billing"]
    assert delta["components"]["unaffected"] == ["auth"]


def test_an_unrelated_component_stays_unaffected():
    old_manifest = {
        "containers": [
            {
                "id": "backend",
                "name": "Backend",
                "files": ["a.py", "b.py", "c.py", "e.py", "z.py"],
            },
        ],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py", "b.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["c.py", "e.py"]},
            {"id": "unrelated", "name": "Unrelated", "container": "backend", "files": ["z.py"]},
        ],
        "edges": [],
    }
    # b.py moves from auth into billing; unrelated's z.py is never touched
    fresh = ClusterResult(
        components=[
            ComponentCluster(id="g0", container_id="c0", files=["a.py"]),
            ComponentCluster(id="g1", container_id="c0", files=["b.py", "c.py", "e.py"]),
            ComponentCluster(id="g2", container_id="c0", files=["z.py"]),
        ],
        containers=[ContainerCluster(id="c0", component_ids=["g0", "g1", "g2"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    assert delta["components"]["unaffected"] == ["unrelated"]
    assert {"auth", "billing"} == {e["id"] for e in delta["components"]["rewritten"]}
