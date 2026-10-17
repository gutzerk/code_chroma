"""The committed graph goldens (read by the C# parity tests) match what the Python engine emits."""

import json

import pytest

from tests import graph_golden


@pytest.fixture(scope="module")
def regenerated():
    return graph_golden.all_goldens()


def _committed(filename):
    return json.loads((graph_golden.GOLDEN_DIR / filename).read_text(encoding="utf-8"))


def test_every_golden_file_is_regenerated_and_nothing_else_is_committed(regenerated):
    committed = {p.name for p in graph_golden.GOLDEN_DIR.glob("*.json")}

    assert committed == set(regenerated)


@pytest.mark.parametrize("repo", graph_golden.REPOS)
def test_committed_golden_matches_a_fresh_export(regenerated, repo):
    fresh = {k: v for k, v in regenerated.items() if k.startswith(f"{repo}.")}

    committed = {k: _committed(k) for k in fresh}

    assert committed == fresh


@pytest.mark.parametrize("repo", graph_golden.REPOS)
def test_rebuilding_nodes_from_the_input_contract_alone_matches_expected_without_edges(repo):
    analysis_input = _committed(f"{repo}.input.json")
    expected = _committed(f"{repo}.expected.json")

    rebuilt = graph_golden.builder_nodes(analysis_input)

    strip = [{**n, "depends_on_ids": []} for n in rebuilt]
    expected_no_edges = [{**n, "depends_on_ids": []} for n in expected["nodes"]]
    assert strip == expected_no_edges
