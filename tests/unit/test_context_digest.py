"""Unit coverage for build_context_digest: the token-efficient index an AI assistant reads."""

import shutil
from pathlib import Path

import pytest

from codechroma.context.digest import build_context_digest
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


@pytest.fixture
def engine(repo):
    graph_engine = GraphEngine(summarizer=AISummarizer())
    graph_engine.analyze(str(repo))
    return graph_engine


def test_digest_carries_only_the_fields_c1_reads(engine, repo):
    digest = build_context_digest(engine, repo)

    assert digest.keys() == {
        "repo_name", "external_import_roots", "declared_dependencies", "readme_excerpt",
    }
    assert digest["repo_name"] == repo.name


def test_declared_dependencies_read_from_pyproject(engine, repo):
    (repo / "pyproject.toml").write_text(
        '[project]\ndependencies = ["fastapi (>=0.1,<0.2)", "anthropic"]\n'
    )

    digest = build_context_digest(engine, repo)

    assert digest["declared_dependencies"] == ["fastapi", "anthropic"]


@pytest.mark.parametrize(
    ("go_mod_text", "expected"),
    [
        pytest.param(
            "module example.com/demo\n\ngo 1.22\n\nrequire (\n"
            "\tgithub.com/lib/pq v1.10.9\n"
            "\tgithub.com/redis/go-redis/v9 v9.5.1 // indirect\n"
            ")\n",
            ["github.com/lib/pq", "github.com/redis/go-redis"],
            id="require_block",
        ),
        pytest.param(
            "module example.com/demo\n\nrequire(\n\tgithub.com/lib/pq v1.10.9\n)\n",
            ["github.com/lib/pq"],
            id="require_block_without_space",
        ),
        pytest.param(
            "module example.com/demo\n\n"
            "require (\n\tgithub.com/lib/pq v1.10.9\n)\n\n"
            "require (\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n",
            ["github.com/lib/pq", "github.com/redis/go-redis"],
            id="multiple_require_blocks",
        ),
        pytest.param(
            "module example.com/demo\n\nrequire (\n\tgithub.com/lib/pq v1.10.9\n",
            ["github.com/lib/pq"],
            id="unclosed_require_block",
        ),
        pytest.param(
            "module example.com/demo\n\ngo 1.22\n\nrequire github.com/lib/pq v1.10.9\n",
            ["github.com/lib/pq"],
            id="single_line_require",
        ),
        pytest.param(
            "this is not a valid go.mod file at all {{{\n",
            [],
            id="malformed_go_mod",
        ),
    ],
)
def test_declared_dependencies_read_from_go_mod(engine, repo, go_mod_text, expected):
    (repo / "go.mod").write_text(go_mod_text)

    digest = build_context_digest(engine, repo)

    assert digest["declared_dependencies"] == expected


def test_declared_dependencies_concatenate_pyproject_and_go_mod(engine, repo):
    (repo / "pyproject.toml").write_text('[project]\ndependencies = ["fastapi"]\n')
    (repo / "go.mod").write_text("module example.com/demo\n\nrequire github.com/lib/pq v1.10.9\n")

    digest = build_context_digest(engine, repo)

    assert digest["declared_dependencies"] == ["fastapi", "github.com/lib/pq"]


def test_readme_excerpt_reads_repo_root_readme(engine, repo):
    (repo / "README.md").write_text("# Sample Repo\n\nA demo billing/users app.")

    digest = build_context_digest(engine, repo)

    assert digest["readme_excerpt"].startswith("# Sample Repo")


def test_missing_readme_and_manifest_yield_empty_digest_fields(engine, repo):
    digest = build_context_digest(engine, repo)

    assert digest["readme_excerpt"] is None
    assert digest["declared_dependencies"] == []
