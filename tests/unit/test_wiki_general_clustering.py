"""One test per C2-join resolution-chain step, plus the manifest shape and reproducibility."""

import shutil
from pathlib import Path

import pytest

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.dependencies import clustering
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "wiki_general_clustering"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


@pytest.fixture
def graph(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    return engine.snapshot()


@pytest.fixture
def registry():
    return AnalyzerRegistry.with_defaults()


def _component_with(result: clustering.ClusterResult, file: str) -> clustering.ComponentCluster:
    return next(c for c in result.components if file in c.files)


def test_folder_default_groups_files_sharing_a_folder(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert _component_with(result, "billing/service.py").id == _component_with(
        result, "billing/invoice.py"
    ).id


def test_call_majority_moves_a_lone_file_into_its_busiest_neighbors_group(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert _component_with(result, "misc/helper.py").id == _component_with(
        result, "billing/service.py"
    ).id


def test_aggregate_merge_joins_two_mutually_isolated_files(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert _component_with(result, "solo_a/a.py").id == _component_with(
        result, "solo_b/b.py"
    ).id


def test_import_fallback_places_a_file_only_ever_imported_never_called(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert _component_with(result, "consts/values.py").id == _component_with(
        result, "billing/service.py"
    ).id


def test_fully_disconnected_file_is_undetermined(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert result.undetermined_files == ["orphan/isolated.py"]


def test_undetermined_file_gets_real_candidate_components_not_code(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)
    weights = clustering.file_edge_weights(graph)

    candidates = clustering.undetermined_candidates("orphan/isolated.py", result, weights)

    assert len(candidates) == 3
    component_ids = {c.id for c in result.components}
    assert all(candidate["id"] in component_ids for candidate in candidates)
    assert all("files" in candidate and candidate["files"] for candidate in candidates)


def test_components_sharing_a_top_level_dir_share_a_container(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    billing = _component_with(result, "billing/service.py")
    reports = _component_with(result, "billing/reports/summary.py")
    assert billing.container_id == reports.container_id


def test_disconnected_component_becomes_its_own_solo_container(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    shipping = _component_with(result, "shipping/service.py")
    container = next(c for c in result.containers if c.id == shipping.container_id)
    assert container.component_ids == [shipping.id]


def _all_placed_files(result: clustering.ClusterResult) -> set[str]:
    return {f for c in result.components for f in c.files} | set(result.undetermined_files)


def test_github_workflow_files_never_reach_a_component_or_undetermined(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert ".github/workflows/ci.yml" not in _all_placed_files(result)


def test_root_level_yaml_configs_never_reach_a_component_or_undetermined(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert ".gremlins.yaml" not in _all_placed_files(result)


def test_testdata_fixtures_never_reach_a_component_or_undetermined(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    assert "misc/testdata/fixture.yaml" not in _all_placed_files(result)


@pytest.mark.parametrize(
    "path",
    [
        ".github/workflows/ci.yml",
        ".specify/memory/constitution.md",
        ".gremlins.yaml",
        "a/testdata/x.yaml",
    ],
)
def test_is_infra_path_flags_ci_and_fixture_paths(path):
    assert clustering._is_infra_path(path) is True


@pytest.mark.parametrize(
    "path", ["billing/service.py", "gateway-orchestration/tools/mock-openai-v1/main.go"]
)
def test_is_infra_path_leaves_real_source_files_alone(path):
    assert clustering._is_infra_path(path) is False


def test_manifest_shape_every_component_has_files_and_a_real_container(graph, repo, registry):
    result = clustering.build_clusters(graph, repo, registry)

    container_ids = {c.id for c in result.containers}
    for component in result.components:
        assert component.files
        assert component.container_id in container_ids
    for edge in result.component_edges + result.container_edges:
        assert edge.count >= 1
        assert edge.from_id != edge.to_id


def test_regenerating_from_the_same_input_is_reproducible(graph, repo, registry):
    first = clustering.build_clusters(graph, repo, registry)
    second = clustering.build_clusters(graph, repo, registry)

    assert first == second
