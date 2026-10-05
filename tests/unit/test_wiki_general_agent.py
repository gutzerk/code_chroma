"""has_documentable_content(): the pre-flight guard against running wiki-general on no real code."""

from dataclasses import dataclass
from pathlib import Path

import pytest

from codechroma.bridge.wiki_general_agent import has_documentable_content
from codechroma.graph.models import Graph, Symbol, SymbolKind


def _symbol(file_path: str, language: str) -> Symbol:
    return Symbol(
        id=f"{file_path}::sym",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name="sym",
        qualified_name="sym",
        start_line=1,
        end_line=1,
        language=language,
    )


@dataclass
class _FakeEngine:
    graph: Graph

    def snapshot(self) -> Graph:
        return self.graph


@dataclass
class _FakeWorkspace:
    engine: _FakeEngine
    root: Path


def _ws(root: Path, *symbols: Symbol) -> _FakeWorkspace:
    graph = Graph(symbols={s.id: s for s in symbols})
    return _FakeWorkspace(engine=_FakeEngine(graph), root=root)


def test_a_repo_with_no_symbols_at_all_has_no_documentable_content(tmp_path):
    ws = _ws(tmp_path)

    assert has_documentable_content(ws) is False


@pytest.mark.parametrize(
    "symbols",
    [
        (_symbol("ci/workflow.yml", "yaml"), _symbol("docker-compose.yml", "yaml")),
        (_symbol("README.md", "python"), _symbol("package.json", "python")),
    ],
    ids=["yaml-language", "doc-and-config-extensions"],
)
def test_yaml_and_doc_config_symbols_alone_do_not_count_as_documentable_content(tmp_path, symbols):
    ws = _ws(tmp_path, *symbols)

    assert has_documentable_content(ws) is False


def test_a_real_code_symbol_counts_as_documentable_content(tmp_path):
    ws = _ws(tmp_path, _symbol("app.py", "python"))

    assert has_documentable_content(ws) is True


def test_a_real_code_symbol_alongside_yaml_and_doc_symbols_still_counts(tmp_path):
    ws = _ws(
        tmp_path,
        _symbol("README.md", "python"),
        _symbol("ci/workflow.yml", "yaml"),
        _symbol("app.py", "python"),
    )

    assert has_documentable_content(ws) is True


def test_an_unparsed_source_file_on_disk_counts_even_with_no_symbols(tmp_path):
    # An unsupported-language repo has zero symbols too -- the raw-file fallback tells them apart.
    (tmp_path / "app.kt").write_text("fun main() {}\n", encoding="utf-8")
    ws = _ws(tmp_path)

    assert has_documentable_content(ws) is True


@pytest.mark.parametrize(
    ("dir_name", "file_name", "contents"),
    [("node_modules", "generated.js", "// built\n"), (".git", "config", "[core]\n")],
    ids=["vendored-directory", "dotdir"],
)
def test_a_file_inside_an_ignored_directory_alone_does_not_count(
    tmp_path, dir_name, file_name, contents
):
    (tmp_path / dir_name).mkdir()
    (tmp_path / dir_name / file_name).write_text(contents, encoding="utf-8")
    ws = _ws(tmp_path)

    assert has_documentable_content(ws) is False
