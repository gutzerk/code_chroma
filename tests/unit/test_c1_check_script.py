"""Unit coverage for the codechroma-c1 self-check script the skill runs after writing c1.json."""

import http.server
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-draw-diagram"
    / "scripts"
    / "check_diagram.py"
)


def _run(tmp_path, diagram, *extra_args):
    path = tmp_path / "c1.json"
    path.write_text(json.dumps(diagram), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "c1", "--json", str(path), *extra_args],
        capture_output=True,
        text=True,
    )


def _leaf(index):
    return {
        "id": f"leaf-{index}",
        "name": f"Leaf {index}",
        "path": f"src/{index}.py",
        "node_id": f"component::src/{index}.py",
    }


def _flatten(node, parent):
    """036: a `{"children": [...]}` tree, flattened into one `nodes[]` list with `parent` set."""
    children = node.get("children")
    flat = {key: value for key, value in node.items() if key != "children"}
    flat["parent"] = parent
    result = [flat]
    for child in children or []:
        result.extend(_flatten(dict(child), flat["id"]))
    return result


def _diagram(children, actors=None):
    """The pre-036 nested-children DSL these tests already used, translated to the shared shape."""
    nodes = [{"id": "system", "name": "Sample", "description": ""}]
    for child in children:
        nodes.extend(_flatten(dict(child), "system"))
    for actor in actors or []:
        actor_children = actor.get("children")
        flat_actor = {k: v for k, v in actor.items() if k != "children" and k != "type"}
        flat_actor["kind"] = actor.get("type")
        nodes.append(flat_actor)
        for child in actor_children or []:
            nodes.extend(_flatten(dict(child), flat_actor["id"]))
    return {"type": "c1", "nodes": nodes, "relations": []}


def test_clean_diagram_exits_zero_with_an_ok_line(tmp_path):
    # A single leaf has nothing else to relate to, so --shape-advisory keeps this about resolution.
    children = [{"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "OK: 1 leaves resolved" in result.stdout


@pytest.mark.parametrize(
    "child,expected",
    [
        ({"id": "ghost", "name": "Ghost", "path": "src/gone.py", "node_id": None},
         "BROKEN ghost path=src/gone.py"),
        ({"id": "orphan", "name": "Orphan", "node_id": None}, "BROKEN orphan path=<none>"),
    ],
    ids=["unresolved", "pathless"],
)
def test_broken_leaf_is_reported_and_exits_nonzero(tmp_path, child, expected):
    result = _run(tmp_path, _diagram([child]))

    assert result.returncode == 1
    assert expected in result.stdout


def test_planned_add_leaf_without_path_is_not_broken(tmp_path):
    children = [
        {"id": "new_fn", "name": "new_fn", "meta": {"plan_kind": "add"}},
        _leaf(1),
    ]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BROKEN" not in result.stdout


def test_conceptual_leaf_with_no_code_reason_is_not_broken(tmp_path):
    # diagram_resolver.py's _stamp_no_code_reason: a resolver-stamped conceptual box.
    children = [
        {"id": "concept_leaf", "name": "concept_leaf", "meta": {"no_code_reason": "conceptual"}},
        _leaf(1),
    ]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BROKEN" not in result.stdout


def test_unresolved_leaf_with_no_code_reason_is_still_broken(tmp_path):
    children = [
        {
            "id": "bad_leaf", "name": "bad_leaf",
            "meta": {"no_code_reason": "unresolved", "no_code_detail": "src/gone.py"},
        }
    ]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 1
    assert "BROKEN bad_leaf" in result.stdout


def test_planned_modify_leaf_with_unresolved_path_is_still_broken(tmp_path):
    children = [
        {
            "id": "changed_fn",
            "name": "changed_fn",
            "path": "src/gone.py",
            "node_id": None,
            "meta": {"plan_kind": "modify"},
        }
    ]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 1
    assert "BROKEN changed_fn path=src/gone.py" in result.stdout


def test_grouping_block_is_not_required_to_resolve(tmp_path):
    children = [{"id": "group", "name": "Group", "children": [_leaf(1), _leaf(2)]}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "max authored depth 2" in result.stdout


def test_actor_children_are_checked_too(tmp_path):
    actors = [
        {
            "id": "db",
            "name": "DB",
            "type": "external_system",
            "children": [{"id": "client", "name": "Client", "path": "x", "node_id": None}],
        }
    ]

    result = _run(tmp_path, _diagram([], actors=actors))

    assert result.returncode == 1
    assert "BROKEN client path=x" in result.stdout


def test_duplicate_sibling_id_is_reported_as_duplicate(tmp_path):
    # 036: ids are unique file-wide now; a repeat is DUPLICATE, not the old advisory-only SIBLING.
    children = [
        {"id": "dup", "name": "First", "path": "src", "node_id": "dir::src"},
        {"id": "dup", "name": "Second", "path": "web", "node_id": "dir::web"},
    ]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 3
    assert "DUPLICATE 'dup' is claimed by 2 blocks" in result.stdout


def test_unknown_kind_is_advisory_only(tmp_path):
    child = {"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}
    children = [{**child, "kind": "databse"}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BADKIND engine kind='databse' is not a recognized icon kind" in result.stdout


def test_recognized_kind_is_silent(tmp_path):
    child = {"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}
    children = [{**child, "kind": "database"}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BADKIND" not in result.stdout


def test_unknown_icon_on_a_child_is_advisory_only(tmp_path):
    child = {"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}
    children = [{**child, "icon": "aws"}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BADICON engine icon='aws' is not a recognized brand icon" in result.stdout


def test_recognized_icon_on_a_child_is_silent(tmp_path):
    child = {"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}
    children = [{**child, "icon": "stripe"}]

    result = _run(tmp_path, _diagram(children), "--shape-advisory")

    assert result.returncode == 0
    assert "BADICON" not in result.stdout


def test_unknown_icon_on_an_actor_is_reported(tmp_path):
    actors = [{"id": "billing", "name": "Billing", "type": "external_system", "icon": "aws"}]

    result = _run(tmp_path, _diagram([], actors=actors))

    assert "BADICON billing icon='aws' is not a recognized brand icon" in result.stdout


def test_all_leaf_top_layer_is_reported_as_flat(tmp_path):
    result = _run(tmp_path, _diagram([_leaf(1), _leaf(2), _leaf(3), _leaf(4)]))

    assert result.returncode == 3
    assert "FLAT system lists 4 leaves with no intermediate layer" in result.stdout


def test_flat_finding_does_not_fire_below_the_top_two_layers(tmp_path):
    deep = [{"id": "b", "name": "B", "children": [_leaf(1), _leaf(2), _leaf(3), _leaf(4)]}]
    children = [{"id": "a", "name": "A", "children": deep}]

    result = _run(tmp_path, _diagram(children))

    assert "FLAT" not in result.stdout


def _db_file(name):
    return {
        "id": name,
        "name": name,
        "path": f"src/db/{name}.py",
        "node_id": f"component::src/db/{name}.py",
    }


def test_files_relisted_under_their_own_directory_are_reported_as_listing(tmp_path):
    group = {
        "id": "data",
        "name": "Data",
        "path": "src/db",
        "node_id": "dir::src/db",
        "children": [_db_file("client"), _db_file("adapter"), _db_file("queries")],
    }

    result = _run(tmp_path, _diagram([group, _leaf(1)]))

    assert result.returncode == 3
    assert "LISTING data re-lists 3 files already shown by its own src/db" in result.stdout


def test_listing_needs_the_parent_to_carry_that_directory(tmp_path):
    group = {
        "id": "data",
        "name": "Data",
        "children": [_db_file("client"), _db_file("adapter"), _db_file("queries")],
    }

    result = _run(tmp_path, _diagram([group, _leaf(1)]), "--shape-advisory")

    assert result.returncode == 0
    assert "LISTING" not in result.stdout


def test_listing_replaces_the_flat_finding_for_the_same_block(tmp_path):
    group = {
        "id": "data",
        "name": "Data",
        "path": "src/db",
        "node_id": "dir::src/db",
        "children": [_db_file(name) for name in ("client", "adapter", "queries", "pool")],
    }

    result = _run(tmp_path, _diagram([group, _leaf(1)]))

    assert "LISTING data" in result.stdout
    assert "FLAT" not in result.stdout


def test_group_with_one_child_is_reported_as_singleton(tmp_path):
    children = [{"id": "group", "name": "Group", "children": [_leaf(1)]}, _leaf(2)]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 3
    assert "SINGLETON group has one child" in result.stdout


def test_external_system_actor_without_children_is_no_longer_reported_as_bare(tmp_path):
    """042: c1 is flat now -- BARE is a decomposition-era check this kind no longer opts into."""
    actors = [{"id": "s3", "name": "S3", "type": "external_system"}]

    result = _run(tmp_path, _diagram([_leaf(1)], actors=actors), "--shape-advisory")

    assert "BARE" not in result.stdout


def test_person_actor_without_children_is_not_reported(tmp_path):
    actors = [{"id": "user", "name": "User", "type": "person"}]

    result = _run(tmp_path, _diagram([_leaf(1)], actors=actors), "--shape-advisory")

    assert result.returncode == 0


def test_disconnected_leaf_and_actor_are_reported_as_orphan_but_a_group_is_not(tmp_path):
    children = [{"id": "group", "name": "Group", "children": [_leaf(1)]}, _leaf(2)]
    actors = [{"id": "billing", "name": "Billing", "type": "person"}]

    result = _run(tmp_path, _diagram(children, actors=actors))

    assert result.returncode == 3
    assert "ORPHAN 'leaf-2' path=src/2.py has no relationship to anything else" in result.stdout
    assert "ORPHAN 'billing' path=<none> has no relationship to anything else" in result.stdout
    assert "ORPHAN 'group'" not in result.stdout


def test_two_actors_wired_only_to_each_other_are_reported_as_an_island(tmp_path):
    actors = [
        {"id": "a", "name": "A", "type": "external_system"},
        {"id": "b", "name": "B", "type": "external_system"},
    ]
    edges = [{"from": "a", "to": "b", "label": "calls"}]

    result = _run(tmp_path, _wired([], edges, actors=actors))

    assert result.returncode == 3
    assert "ISLAND 'a', 'b' (2 entries) relates only to itself" in result.stdout
    assert "ORPHAN 'a'" not in result.stdout
    assert "ORPHAN 'b'" not in result.stdout


def test_shape_advisory_demotes_the_c1_island_finding(tmp_path):
    actors = [
        {"id": "a", "name": "A", "type": "external_system"},
        {"id": "b", "name": "B", "type": "external_system"},
    ]
    edges = [{"from": "a", "to": "b", "label": "calls"}]

    result = _run(tmp_path, _wired([], edges, actors=actors), "--shape-advisory")

    assert result.returncode == 0
    assert "ISLAND" in result.stdout


def test_actor_wired_to_system_is_not_reported_as_an_island(tmp_path):
    actors = [{"id": "a", "name": "A", "type": "external_system", "children": [_leaf(1)]}]
    edges = [{"from": "a", "to": "system", "label": "uses"}]

    result = _run(tmp_path, _wired([], edges, actors=actors), "--shape-advisory")

    assert "ISLAND" not in result.stdout


def test_filler_child_name_is_reported_as_vague(tmp_path):
    children = [{"id": "misc", "name": "Helpers", "path": "src", "node_id": "dir::src"}]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 3
    assert "VAGUE misc name='Helpers'" in result.stdout


def test_large_two_layer_diagram_is_reported_as_shallow(tmp_path):
    groups = [
        {"id": f"g{i}", "name": f"G{i}", "children": [_leaf(i * 2), _leaf(i * 2 + 1)]}
        for i in range(6)
    ]

    result = _run(tmp_path, _diagram(groups))

    assert result.returncode == 3
    assert "SHALLOW <root> 18 blocks in only 2 authored layer(s)" in result.stdout


def test_shape_advisory_reports_without_failing(tmp_path):
    result = _run(tmp_path, _diagram([_leaf(1), _leaf(2), _leaf(3), _leaf(4)]), "--shape-advisory")

    assert result.returncode == 0
    assert "FLAT system" in result.stdout
    assert "OK: 4 leaves resolved" in result.stdout


def test_broken_paths_outrank_shape_findings(tmp_path):
    children = [{"id": "ghost", "name": "Core", "path": "src/gone.py", "node_id": None}]

    result = _run(tmp_path, _diagram(children))

    assert result.returncode == 1
    assert "VAGUE ghost" in result.stdout


def _wired(children, relations, actors=None):
    diagram = _diagram(children, actors=actors)
    diagram["relations"] = relations
    return diagram


def _ladder():
    """A route -> service -> repository chain: 9 blocks over 3 layers, enough to expect wiring."""
    return [
        {"id": "routes", "name": "Routes", "children": [_leaf(1), _leaf(2), _leaf(3)]},
        {"id": "services", "name": "Services", "children": [_leaf(4), _leaf(5), _leaf(6)]},
        {"id": "repo", "name": "Repository", "path": "src/db", "node_id": "dir::src/db"},
    ]


def test_layered_diagram_without_internal_arrows_is_reported_as_noarrows(tmp_path):
    result = _run(tmp_path, _wired(_ladder(), []))

    assert result.returncode == 3
    assert "NOARROWS <root> 2 authored layers but no relationship" in result.stdout


def test_one_internal_arrow_clears_the_noarrows_finding(tmp_path):
    edges = [{"from": "leaf-1", "to": "leaf-4", "label": "Uses"}]

    result = _run(tmp_path, _wired(_ladder(), edges))

    assert "NOARROWS" not in result.stdout


def test_relationship_endpoint_matching_no_block_is_reported_as_dangling(tmp_path):
    edges = [{"from": "routes", "to": "nowhere", "label": "Uses"}]

    result = _run(tmp_path, _wired(_ladder(), edges))

    assert result.returncode == 1
    assert "DANGLING 'routes' -> 'nowhere' to='nowhere' matches no block" in result.stdout


def test_self_referential_relationship_is_reported(tmp_path):
    edges = [{"from": "routes", "to": "routes", "label": "Uses"}]

    result = _run(tmp_path, _wired(_ladder(), edges))

    assert result.returncode == 1
    assert "SELF 'routes' -> 'routes' connects a block to itself" in result.stdout


def test_edge_restating_parent_child_nesting_is_advisory(tmp_path):
    edges = [{"from": "routes", "to": "leaf-1", "label": "Contains"}]

    result = _run(tmp_path, _wired(_ladder(), edges))

    assert "NESTING-EDGE 'routes' -> 'leaf-1' only restates the nesting" in result.stdout


def test_a_directed_cycle_between_blocks_is_an_advisory_not_a_failure(tmp_path):
    edges = [
        {"from": "leaf-1", "to": "leaf-2", "label": "a"},
        {"from": "leaf-2", "to": "leaf-3", "label": "b"},
        {"from": "leaf-3", "to": "leaf-1", "label": "c"},
    ]

    result = _run(tmp_path, _wired(_ladder(), edges))

    # The cycle prints as an advisory -- it never pushes the run to the broken tier (returncode 1).
    assert result.returncode != 1
    assert "CYCLES 'leaf-1' -> 'leaf-2' -> 'leaf-3' -> 'leaf-1'" in result.stdout


def test_id_reused_across_branches_is_reported_as_duplicate(tmp_path):
    children = [
        {"id": "a", "name": "A", "children": [_leaf(1)]},
        {"id": "b", "name": "B", "children": [_leaf(1)]},
    ]

    result = _run(tmp_path, _wired(children, []))

    assert result.returncode == 3
    assert "DUPLICATE 'leaf-1' is claimed by 2 blocks" in result.stdout


def test_path_claimed_by_two_blocks_is_reported_as_duplicate_path(tmp_path):
    shared = {"path": "src/db/adapter.py", "node_id": "component::src/db/adapter.py"}
    children = [
        {"id": "layer", "name": "Layer", "children": [{"id": "adapter", "name": "A", **shared}]},
        {"id": "pg-side", "name": "PG side", "children": [{"id": "pg", "name": "PG", **shared}]},
    ]

    result = _run(tmp_path, _wired(children, []))

    assert result.returncode == 3
    assert "DUPLICATE-PATH src/db/adapter.py is claimed by" in result.stdout


def _make_handler(routes):
    class _Handler(http.server.BaseHTTPRequestHandler):
        """Serves canned JSON for the two bridge routes the script talks to, keyed by full path."""

        def do_GET(self):
            payload = routes.get(self.path)
            self.send_response(200 if payload is not None else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload or {}).encode())

        def log_message(self, *args):
            return

    return _Handler


@pytest.fixture
def bridge():
    """Yields a start(routes) -> base_url callable backed by a real localhost HTTP server."""
    servers = []

    def start(routes):
        server = http.server.HTTPServer(("127.0.0.1", 0), _make_handler(routes))
        servers.append(server)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{server.server_port}"

    yield start
    for server in servers:
        server.shutdown()


def _run_against(url, *extra_args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "c1", "--url", url, *extra_args],
        capture_output=True,
        text=True,
    )


def test_directory_leaf_with_subdirectories_is_reported_as_uncovered(bridge):
    leaf = {"id": "db", "name": "DB", "path": "src/db", "node_id": "dir::src/db"}
    url = bridge(
        {
            "/repos/default/c1": _diagram([leaf, _leaf(1)]),
            "/repos/default/structure?root=dir%3A%3Asrc%2Fdb&depth=1": {
                "nodes": [{"node_id": "dir::src/db/models", "level": "folder"}]
            },
        }
    )

    result = _run_against(url)

    assert result.returncode == 3
    assert "UNCOVERED db path=src/db has sub-directories" in result.stdout


def test_directory_leaf_of_files_only_is_accepted(bridge):
    leaf = {"id": "db", "name": "DB", "path": "src/db", "node_id": "dir::src/db"}
    url = bridge(
        {
            "/repos/default/c1": _diagram([leaf, _leaf(1)]),
            "/repos/default/structure?root=dir%3A%3Asrc%2Fdb&depth=1": {
                "nodes": [{"node_id": "component::src/db/client.py", "level": "file"}]
            },
        }
    )

    result = _run_against(url, "--shape-advisory")

    assert result.returncode == 0
    assert "UNCOVERED" not in result.stdout


def _coverage(percent, entries):
    coverage = {"total_files": 400, "percent": percent, "entries": entries, "truncated": False}
    return {"coverage": coverage, "staleness": None, "generation_data": None}


def test_low_coverage_no_longer_fires_since_c1_stopped_opting_in(bridge):
    """042: c1 is flat now -- coverage_source is unset, so this never fetches /c1/context at all."""
    url = bridge(
        {
            "/repos/default/c1": _diagram([_leaf(1)]),
            "/repos/default/c1/context": _coverage(
                20,
                [
                    {"path": "web/src", "file_count": 200},
                    {"path": "src/graph", "file_count": 120},
                ],
            ),
        }
    )

    result = _run_against(url, "--shape-advisory")

    assert result.returncode == 0
    assert "COVERAGE" not in result.stdout


def test_coverage_is_not_checked_against_a_raw_file(tmp_path):
    children = [{"id": "engine", "name": "Engine", "path": "src", "node_id": "dir::src"}]

    result = _run(tmp_path, _diagram(children))

    assert "COVERAGE" not in result.stdout


def test_unreadable_diagram_exits_two(tmp_path):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "c1", "--json", str(tmp_path / "missing.json")],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert "could not read the diagram" in result.stderr


def test_generated_template_passes_self_check(tmp_path):
    from codechroma.context.c1_template import generate_c1_template

    digest = {
        "repo_name": "sample",
        "declared_dependencies": ["stripe", "some-unknown-package"],
    }

    result = _run(tmp_path, generate_c1_template(digest))

    assert result.returncode == 0
    assert result.stdout.strip() == "OK: 0 leaves resolved, max authored depth 0"
