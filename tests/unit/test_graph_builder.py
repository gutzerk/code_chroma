"""Unit tests for GraphBuilder.build(), incl. the doc_only folder computation."""

from codechroma.graph.builder import GraphBuilder
from codechroma.graph.models import HierarchyLevel, Symbol, SymbolKind


def _module_symbol(file_path: str) -> Symbol:
    return Symbol(
        id=f"module::{file_path}",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name=file_path,
        qualified_name=file_path,
        start_line=1,
        end_line=1,
        language="python",
    )


def _dir_node(nodes, source_path):
    return next(n for n in nodes if n.source_path == source_path)


def test_folder_with_only_doc_file_is_doc_only():
    nodes, _symbols = GraphBuilder().build({"docs/README.md": None})

    assert _dir_node(nodes, "docs").doc_only is True


def test_folder_with_doc_and_parsed_code_file_is_not_doc_only():
    nodes, _symbols = GraphBuilder().build(
        {
            "pkg/README.md": None,
            "pkg/mod.py": [_module_symbol("pkg/mod.py")],
        }
    )

    assert _dir_node(nodes, "pkg").doc_only is False


def test_folder_with_only_unparsed_code_file_is_not_doc_only():
    nodes, _symbols = GraphBuilder().build({"pkg/broken.py": None})

    assert _dir_node(nodes, "pkg").doc_only is False


def test_nested_doc_only_subfolder_under_mixed_parent():
    nodes, _symbols = GraphBuilder().build(
        {
            "pkg/mod.py": [_module_symbol("pkg/mod.py")],
            "pkg/docs/README.md": None,
            "pkg/docs/guide.rst": None,
        }
    )

    assert _dir_node(nodes, "pkg/docs").doc_only is True
    assert _dir_node(nodes, "pkg").doc_only is False


def test_doc_only_propagates_two_levels_up():
    nodes, _symbols = GraphBuilder().build(
        {
            "pkg/docs/guides/one.txt": None,
            "pkg/docs/guides/two.txt": None,
        }
    )

    assert _dir_node(nodes, "pkg/docs/guides").doc_only is True
    assert _dir_node(nodes, "pkg/docs").doc_only is True
    assert _dir_node(nodes, "pkg").doc_only is True


def test_component_file_node_never_gets_doc_only_set():
    nodes, _symbols = GraphBuilder().build({"docs/README.md": None})

    component = next(n for n in nodes if n.level == HierarchyLevel.COMPONENT)
    assert component.doc_only is False
