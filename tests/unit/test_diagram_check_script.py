"""The unified self-check's shared contract: exit tiers, the density family, and prose/code sync."""

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

SKILL = (
    Path(__file__).parent.parent.parent / ".claude" / "skills" / "codechroma-draw-diagram"
)
SCRIPT = SKILL / "scripts" / "check_diagram.py"
RULES = SKILL / "references" / "drawing-rules.md"


def _load_module():
    """Imports the script by path, registering it in sys.modules first so its @dataclass works."""
    spec = importlib.util.spec_from_file_location("check_diagram", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_diagram"] = module
    spec.loader.exec_module(module)
    return module


def _run(tmp_path, kind, diagram, *extra):
    path = tmp_path / f"{kind}.json"
    path.write_text(json.dumps(diagram))
    argv = [sys.executable, str(SCRIPT), "--kind", kind, "--json", str(path), *extra]
    if kind == "custom":
        argv[4:4] = ["--type", "flow"]
    return subprocess.run(argv, capture_output=True, text=True)


def _flat(node_count, *, relations=None, label="uses"):
    nodes = [
        {"id": f"n{i}", "name": f"N{i}", "node_id": f"component::src/{i}.py"}
        for i in range(node_count)
    ]
    if relations is None:
        relations = [{"from": f"n{i}", "to": f"n{i + 1}", "label": label}
                     for i in range(node_count - 1)]
    return {"nodes": nodes, "relations": relations}


def _markdown_budgets():
    """The budget table in drawing-rules.md, parsed back into the shape `_BUDGETS` has."""
    rows = re.findall(
        r"^\|\s*(c1|patterns|impact|epics|custom|sequence)\s*\|(.+)\|\s*$",
        RULES.read_text(),
        re.M,
    )
    columns = ("max_nodes", "max_relations", "max_name_chars", "max_edge_label_chars")
    return {
        kind: dict(
            zip(columns, [int(c.strip()) for c in rest.split("|") if c.strip()], strict=True)
        )
        for kind, rest in rows
    }


def test_the_prose_budget_table_and_the_machine_one_cannot_drift():
    # 🔴 "Rules in both places" is only true if something checks; this is that something.
    module = _load_module()

    assert _markdown_budgets() == module._BUDGETS


@pytest.mark.parametrize("kind", ["c1", "patterns", "impact", "custom"])
def test_every_kind_reports_an_unreadable_diagram_the_same_way(tmp_path, kind):
    argv = [sys.executable, str(SCRIPT), "--kind", kind, "--json", str(tmp_path / "gone.json")]
    if kind == "custom":
        argv[4:4] = ["--type", "flow"]

    result = subprocess.run(argv, capture_output=True, text=True)

    assert result.returncode == 2


@pytest.mark.parametrize("kind", ["patterns", "impact", "custom"])
def test_shape_advisory_now_exists_for_every_kind_not_just_c1(tmp_path, kind):
    # impact and custom had no such flag before the merge; an orphan was unappealable there.
    orphaned = {"nodes": [{"id": "a", "name": "A", "node_id": "component::src/a.py"},
                          {"id": "b", "name": "B", "node_id": "component::src/b.py"}],
                "relations": []}

    strict = _run(tmp_path, kind, orphaned)
    lenient = _run(tmp_path, kind, orphaned, "--shape-advisory")

    assert strict.returncode == 3
    assert lenient.returncode == 0


def test_too_many_boxes_is_a_shape_finding_not_a_hard_failure(tmp_path):
    module = _load_module()
    over = module._BUDGETS["impact"]["max_nodes"] + 5

    result = _run(tmp_path, "impact", _flat(over))

    assert result.returncode == 3
    assert "CROWDED" in result.stdout


def test_a_diagram_inside_its_budget_says_nothing_about_density(tmp_path):
    result = _run(tmp_path, "impact", _flat(4))

    assert "CROWDED" not in result.stdout
    assert "EDGEBOMB" not in result.stdout


def test_epics_group_connectivity_is_never_flagged_an_orphan_or_island(tmp_path):
    """Epics hierarchy nests via meta.recipe_key/group frames, not `relations[]` (they carry only
    cross-epic dependency edges, usually none) -- so ORPHAN/ISLAND connectivity checks are disabled
    for this kind. A lone epic, a framed story set, and a full-graph epic pass with zero edges."""
    diagram = {
        "nodes": [
            {"id": "EP-1", "name": "EP-1", "group": "platform"},
            {"id": "EP-1-01", "name": "s1", "group": "EP-1",
             "meta": {"recipe_key": "EP-1::phase-1::s1"}},
            {"id": "EP-1-02", "name": "s2", "group": "EP-1",
             "meta": {"recipe_key": "EP-1::phase-1::s2"}},
        ],
        "relations": [],
    }

    result = _run(tmp_path, "epics", diagram)

    assert result.returncode == 0
    assert "ORPHAN" not in result.stdout
    assert "ISLAND" not in result.stdout


def test_epics_lone_epic_with_no_relations_is_not_an_orphan(tmp_path):
    """A single bare epic with no cross-epic edges is a legal diagram, not a disconnected stub --
    the ORPHAN/ISLAND checks that would flag it apply to edge-connected kinds only."""
    diagram = {
        "nodes": [
            {"id": "EP-1", "name": "EP-1"},
            {"id": "EP-2", "name": "EP-2", "group": "planning"},
        ],
        "relations": [],
    }

    result = _run(tmp_path, "epics", diagram)

    assert result.returncode == 0
    assert "ORPHAN" not in result.stdout


def test_too_many_hero_relations_is_advisory_and_never_fails_the_run(tmp_path):
    diagram = _flat(
        4,
        relations=[{"from": f"n{i}", "to": f"n{i + 1}", "hero": True} for i in range(3)],
    )

    result = _run(tmp_path, "impact", diagram)

    assert result.returncode == 0
    assert "TOOMANYHERO 3 hero relation(s), budget 2" in result.stdout


def test_hero_relations_inside_budget_say_nothing(tmp_path):
    diagram = _flat(
        4,
        relations=[{"from": f"n{i}", "to": f"n{i + 1}", "hero": i == 0} for i in range(3)],
    )

    result = _run(tmp_path, "impact", diagram)

    assert "TOOMANYHERO" not in result.stdout


def test_hero_budget_is_not_checked_for_a_kind_without_one(tmp_path):
    diagram = _flat(
        4,
        relations=[{"from": f"n{i}", "to": f"n{i + 1}", "hero": True} for i in range(3)],
    )

    result = _run(tmp_path, "patterns", diagram)

    assert "TOOMANYHERO" not in result.stdout


def test_an_overlong_edge_label_is_advisory_and_never_fails_the_run(tmp_path):
    module = _load_module()
    long_label = "x" * (module._BUDGETS["impact"]["max_edge_label_chars"] + 10)

    result = _run(tmp_path, "impact", _flat(2, label=long_label))

    assert result.returncode == 0
    assert "LONGLABEL" in result.stdout


def test_unlabeled_relations_are_summarized_on_one_line_not_one_per_edge(tmp_path):
    diagram = _flat(4, relations=[{"from": f"n{i}", "to": f"n{i + 1}"} for i in range(3)])

    result = _run(tmp_path, "impact", diagram)

    assert result.stdout.count("UNLABELED") == 1
    assert "3 of 3" in result.stdout


def test_a_directed_cycle_is_reported_as_an_advisory_not_a_failure(tmp_path):
    # n0 -> n1 -> n2 -> n0 is a genuine directed cycle -- flagged, but the run still passes.
    diagram = _flat(
        3,
        relations=[
            {"from": "n0", "to": "n1", "label": "a"},
            {"from": "n1", "to": "n2", "label": "b"},
            {"from": "n2", "to": "n0", "label": "c"},
        ],
    )

    result = _run(tmp_path, "impact", diagram)

    assert result.returncode == 0
    assert "CYCLES 'n0' -> 'n1' -> 'n2' -> 'n0'" in result.stdout


def test_a_chain_has_no_cycle_finding(tmp_path):
    diagram = _flat(4)

    result = _run(tmp_path, "impact", diagram)

    assert "CYCLES" not in result.stdout


def test_a_self_loop_is_only_a_CYCLES_finding_when_self_edges_are_allowed(tmp_path):
    # `impact` forbids self-edges -- `_check_relations` already reports SELF, not a cycle.
    diagram = _flat(1, relations=[{"from": "n0", "to": "n0", "label": "self"}])

    result = _run(tmp_path, "impact", diagram)

    assert result.returncode == 1
    assert "CYCLES" not in result.stdout
    assert "SELF 'n0' -> 'n0'" in result.stdout


def test_a_self_loop_in_a_dependency_graph_is_a_cycle_finding(tmp_path):
    # `dependency-graph` style allows self-edges -- the loop shows up as a 1-edge cycle advisory.
    diagram = {
        **_flat(1, relations=[{"from": "n0", "to": "n0", "label": "self"}]),
        "style": "dependency-graph",
    }

    result = _run(tmp_path, "custom", diagram)

    assert result.returncode == 0
    assert "CYCLES 'n0' -> 'n0'" in result.stdout


def test_a_bridge_node_is_reported_as_an_articulation_advisory(tmp_path):
    # n0 -> n1 -> n2: removing n1 severs n0 and n2 -- a bridge the advisory should name.
    diagram = _flat(
        3,
        relations=[
            {"from": "n0", "to": "n1", "label": "a"},
            {"from": "n1", "to": "n2", "label": "b"},
        ],
    )

    result = _run(tmp_path, "impact", diagram)

    assert result.returncode == 0
    assert "ARTICULATION 'n1' is a bridge" in result.stdout


def test_a_chain_without_a_bridge_is_quiet(tmp_path):
    # n0 -> n1 (a two-node edge): no interior node whose removal disconnects anything.
    diagram = _flat(2)

    result = _run(tmp_path, "impact", diagram)

    assert "ARTICULATION" not in result.stdout


def test_a_node_inside_a_cycle_is_never_a_bridge(tmp_path):
    # n0 <-> n1 <-> n2: every node is in a >1 SCC, so none is a single fragile connexion.
    diagram = _flat(
        3,
        relations=[
            {"from": "n0", "to": "n1", "label": "a"},
            {"from": "n1", "to": "n2", "label": "b"},
            {"from": "n2", "to": "n0", "label": "c"},
        ],
    )

    result = _run(tmp_path, "impact", diagram)

    assert "ARTICULATION" not in result.stdout


def test_a_high_degree_node_is_a_hub_but_not_a_bridge(tmp_path):
    # A complete graph K5: every node has degree 4, yet no single removal disconnects it -- so each
    # is a hub (high-connectedness), never a bridge (no articulation point).
    diagram = _flat(
        5,
        relations=[{"from": f"n{i}", "to": f"n{j}", "label": "a"}
                   for i in range(5) for j in range(i + 1, 5)],
    )

    result = _run(tmp_path, "impact", diagram)

    assert result.returncode == 0
    assert "ARTICULATION 'n0' is a hub" in result.stdout
    assert "is a bridge" not in result.stdout


def test_a_dependency_graph_custom_diagram_is_exempt_from_the_density_budgets(tmp_path):
    # Its whole point is being exhaustive, the same reason SELF is already exempt for that style.
    module = _load_module()
    over = module._BUDGETS["custom"]["max_nodes"] + 5
    dense = {**_flat(over), "style": "dependency-graph"}

    result = _run(tmp_path, "custom", dense)

    assert "CROWDED" not in result.stdout


def _dir_leaf(leaf_id, path):
    return {
        "id": leaf_id, "name": leaf_id, "path": path, "node_id": f"dir::{path}", "parent": "system"
    }


def _c1_with_dir_leaves(count):
    children = [_dir_leaf(f"b{i}", f"src/dir{i}") for i in range(count)]
    return {"type": "c1", "nodes": [{"id": "system", "name": "Sys"}, *children], "relations": []}


class _FakeResponse:
    """A urlopen() context-manager stand-in wrapping a canned JSON payload."""

    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def test_dir_leaf_id_collection_is_network_free_and_matches_check_leafs_predicate(monkeypatch):
    module = _load_module()

    def _forbidden_urlopen(*_args, **_kwargs):
        raise AssertionError("collection must not make any network calls")

    monkeypatch.setattr(module.urllib.request, "urlopen", _forbidden_urlopen)
    diagram = _c1_with_dir_leaves(3)
    non_dir_leaf = {
        "id": "code", "name": "code", "path": "src/f.py", "node_id": "component::src/f.py",
        "parent": "system",
    }
    diagram["nodes"].append(non_dir_leaf)
    by_parent = module._children_by_parent(diagram["nodes"])

    ids = module._collect_dir_leaf_ids(diagram["nodes"], by_parent)

    assert ids == ["dir::src/dir0", "dir::src/dir1", "dir::src/dir2"]
    # _check_leaf's own gate agrees: the one non-dir:: leaf above must be excluded here too.
    assert module._dir_leaf_id(non_dir_leaf) is None
    b0 = next(node for node in diagram["nodes"] if node["id"] == "b0")
    assert module._dir_leaf_id(b0) == "dir::src/dir0"


def test_dir_leaf_id_collection_caps_at_the_uncovered_probe_limit():
    module = _load_module()
    diagram = _c1_with_dir_leaves(module.UNCOVERED_PROBE_LIMIT + 10)
    by_parent = module._children_by_parent(diagram["nodes"])

    ids = module._collect_dir_leaf_ids(diagram["nodes"], by_parent)

    assert len(ids) == module.UNCOVERED_PROBE_LIMIT


def test_make_probe_batch_fetches_once_then_the_probe_reads_only_the_warm_cache(monkeypatch):
    module = _load_module()
    calls = []

    def _fake_urlopen(url, timeout=None):
        calls.append(url)
        has_children = "dir1" in url
        return _FakeResponse({"nodes": [{"level": "folder"}] if has_children else []})

    monkeypatch.setattr(module.urllib.request, "urlopen", _fake_urlopen)
    diagram = _c1_with_dir_leaves(3)
    by_parent = module._children_by_parent(diagram["nodes"])
    args = argparse.Namespace(url="http://localhost:8000", repo="default")

    probe = module._make_probe(diagram["nodes"], by_parent, args)
    calls_after_batch = len(calls)
    results = [probe(f"dir::src/dir{i}") for i in range(3)] + [probe("dir::src/dir0")]

    assert calls_after_batch == 3
    assert len(calls) == calls_after_batch
    assert results == [False, True, False, False]


def test_uncovered_findings_are_unchanged_by_the_parallel_probe_batch(monkeypatch):
    """Same UNCOVERED findings as before parallelization -- only the fetch mechanism changed."""
    module = _load_module()

    def _fake_urlopen(url, timeout=None):
        has_children = "dir1" in url or "dir3" in url
        return _FakeResponse({"nodes": [{"level": "folder"}] if has_children else []})

    monkeypatch.setattr(module.urllib.request, "urlopen", _fake_urlopen)
    diagram = _c1_with_dir_leaves(4)
    args = argparse.Namespace(
        url="http://localhost:8000", repo="default", json_path=None, kind="c1"
    )

    report = module._inspect_hierarchical(diagram, module._BUILTIN_CHECKS["c1"], args)

    uncovered = sorted(line for line in report.shape if line.startswith("UNCOVERED"))
    assert uncovered == [
        "UNCOVERED b1 path=src/dir1 has sub-directories",
        "UNCOVERED b3 path=src/dir3 has sub-directories",
    ]
