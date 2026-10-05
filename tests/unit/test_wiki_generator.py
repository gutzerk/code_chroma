"""Unit tests for wiki/generator.py's generate_wiki(), against a small hand-built Graph."""

import json
from pathlib import Path

import pytest

from codechroma.dependencies.digest import _FileSymbols
from codechroma.graph.models import Graph, HierarchyLevel, HierarchyNode, Symbol, SymbolKind
from codechroma.wiki.generator import _gaps_for_file, generate_wiki


def _module(
    file_path: str, dotted: str, docstring: str | None = None, language: str = "python"
) -> Symbol:
    return Symbol(
        id=f"{file_path}::module::{dotted}",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name=dotted,
        qualified_name=dotted,
        start_line=1,
        end_line=1,
        language=language,
        docstring=docstring,
    )


def _class(
    file_path: str,
    name: str,
    module_id: str,
    docstring: str | None = None,
    language: str = "python",
    is_exported: bool = False,
) -> Symbol:
    return Symbol(
        id=f"{file_path}::class::{name}",
        file_path=file_path,
        kind=SymbolKind.CLASS,
        name=name,
        qualified_name=name,
        start_line=1,
        end_line=5,
        language=language,
        parent_symbol_id=module_id,
        docstring=docstring,
        is_exported=is_exported,
    )


def _function(
    file_path: str,
    name: str,
    parent_id: str,
    docstring: str | None = None,
    language: str = "python",
    is_exported: bool = False,
) -> Symbol:
    return Symbol(
        id=f"{file_path}::function::{name}",
        file_path=file_path,
        kind=SymbolKind.FUNCTION,
        name=name,
        qualified_name=name,
        start_line=2,
        end_line=3,
        language=language,
        parent_symbol_id=parent_id,
        docstring=docstring,
        is_exported=is_exported,
    )


def _variable(file_path: str, name: str, module_id: str, line: int = 4) -> Symbol:
    return Symbol(
        id=f"{file_path}::variable::{name}",
        file_path=file_path,
        kind=SymbolKind.VARIABLE,
        name=name,
        qualified_name=name,
        start_line=line,
        end_line=line,
        language="python",
        parent_symbol_id=module_id,
    )


def _fixture_graph() -> Graph:
    documented_path = "pkg/documented.py"
    undocumented_path = "pkg/undocumented.py"
    documented_module = _module(documented_path, "pkg.documented", "Documented module.")
    documented_class = _class(
        documented_path, "Widget", documented_module.id, "A documented widget."
    )
    documented_method = _function(
        documented_path, "Widget.render", documented_class.id, "Renders the widget."
    )
    variable = _variable(documented_path, "MAX_SIZE", documented_module.id)
    undocumented_module = _module(undocumented_path, "pkg.undocumented")
    undocumented_function = _function(undocumented_path, "helper", undocumented_module.id)

    symbols = {
        s.id: s
        for s in (
            documented_module,
            documented_class,
            documented_method,
            variable,
            undocumented_module,
            undocumented_function,
        )
    }
    nodes = {
        "dir::pkg": HierarchyNode(
            id="dir::pkg", name="pkg", level=HierarchyLevel.SYSTEM, source_path="pkg"
        ),
        f"component::{documented_path}": HierarchyNode(
            id=f"component::{documented_path}",
            name="documented.py",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path=documented_path,
        ),
        f"component::{undocumented_path}": HierarchyNode(
            id=f"component::{undocumented_path}",
            name="undocumented.py",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path=undocumented_path,
        ),
    }
    return Graph(nodes=nodes, symbols=symbols)


def test_generate_wiki_writes_a_root_page(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    assert (result.output_dir / "index.md").exists()


def test_generate_wiki_writes_one_page_per_top_level_folder(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    assert (result.output_dir / "files" / "pkg" / "index.md").exists()


def test_generate_wiki_writes_one_page_per_parsed_source_file(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    assert (result.output_dir / "files" / "pkg" / "documented.md").exists()
    assert (result.output_dir / "files" / "pkg" / "undocumented.md").exists()


def test_generate_wiki_reports_a_page_count_matching_disk(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    assert len(result.pages) == 4


def test_generate_wiki_shows_real_docstrings_on_the_file_page(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    text = (result.output_dir / "files" / "pkg" / "documented.md").read_text(encoding="utf-8")
    assert "Documented module." in text
    assert "A documented widget." in text
    assert "Renders the widget." in text


def test_generate_wiki_lists_module_parameters(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    text = (result.output_dir / "files" / "pkg" / "documented.md").read_text(encoding="utf-8")
    assert "MAX_SIZE" in text


def test_generate_wiki_marks_undocumented_items_instead_of_omitting_them(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    text = (result.output_dir / "files" / "pkg" / "undocumented.md").read_text(encoding="utf-8")
    assert "helper" in text
    assert "no docstring" in text.lower()


def test_generate_wiki_replaces_previous_output_in_full(tmp_path):
    output_dir = tmp_path / ".codechroma" / "wiki"
    output_dir.mkdir(parents=True)
    stale = output_dir / "stale.md"
    stale.write_text("stale content", encoding="utf-8")

    generate_wiki(_fixture_graph(), tmp_path, output_dir)

    assert not stale.exists()


def test_generate_wiki_excludes_documented_items_from_gaps(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    gaps = json.loads(result.gap_json_path.read_text(encoding="utf-8"))
    names = {g["qualified_name"] for g in gaps}
    assert "Widget" not in names
    assert "Widget.render" not in names


def test_generate_wiki_includes_undocumented_item_with_full_gap_shape(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    gaps = json.loads(result.gap_json_path.read_text(encoding="utf-8"))
    entry = next(g for g in gaps if g["qualified_name"] == "helper")
    assert entry == {
        "path": "pkg/undocumented.py",
        "qualified_name": "helper",
        "kind": "function",
        "reason": "no docstring",
    }


def test_generate_wiki_undocumented_count_matches_gap_list_length(tmp_path):
    result = generate_wiki(_fixture_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    gaps = json.loads(result.gap_json_path.read_text(encoding="utf-8"))
    assert result.undocumented_count == len(gaps)


def _nested_folder_graph() -> Graph:
    file_path = "pkg/sub/inner.py"
    module = _module(file_path, "pkg.sub.inner", "Inner module.")
    nodes = {
        "dir::pkg": HierarchyNode(
            id="dir::pkg", name="pkg", level=HierarchyLevel.SYSTEM, source_path="pkg"
        ),
        "dir::pkg/sub": HierarchyNode(
            id="dir::pkg/sub",
            name="sub",
            level=HierarchyLevel.PILLAR,
            parent_ids=["dir::pkg"],
            source_path="pkg/sub",
        ),
        f"component::{file_path}": HierarchyNode(
            id=f"component::{file_path}",
            name="inner.py",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg/sub"],
            source_path=file_path,
        ),
    }
    return Graph(nodes=nodes, symbols={module.id: module})


def test_generate_wiki_writes_an_index_for_a_nested_subfolder(tmp_path):
    result = generate_wiki(_nested_folder_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    nested_index = result.output_dir / "files" / "pkg" / "sub" / "index.md"
    assert nested_index.exists()
    assert "inner.py" in nested_index.read_text(encoding="utf-8")


def test_generate_wiki_links_a_nested_subfolder_from_its_parent(tmp_path):
    result = generate_wiki(_nested_folder_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    parent_index = result.output_dir / "files" / "pkg" / "index.md"
    assert "sub/index.md" in parent_index.read_text(encoding="utf-8")


def _go_function_file_symbols(name: str, is_exported: bool) -> _FileSymbols:
    file_path = "pkg/widget.go"
    module = _module(file_path, "widget", docstring="Package widget renders things.", language="go")
    func = _function(file_path, name, module.id, language="go", is_exported=is_exported)
    return _FileSymbols(
        path=file_path, module=module, classes=[], methods_by_class_id={}, functions=[func]
    )


def _ts_function_file_symbols(file_path: str, is_exported: bool) -> _FileSymbols:
    module = _module(file_path, "mod", language="typescript")
    func = _function(
        file_path, "helper", module.id, language="typescript", is_exported=is_exported
    )
    return _FileSymbols(
        path=file_path, module=module, classes=[], methods_by_class_id={}, functions=[func]
    )


def test_gaps_flag_an_undocumented_exported_go_function():
    gaps = _gaps_for_file(_go_function_file_symbols("Helper", is_exported=True))

    assert any(g.qualified_name == "Helper" for g in gaps)


def test_gaps_skip_an_undocumented_unexported_go_function():
    gaps = _gaps_for_file(_go_function_file_symbols("helper", is_exported=False))

    assert gaps == []


def test_gaps_flag_an_undocumented_go_package_regardless_of_file_name():
    file_path = "pkg/widget.go"
    module = _module(file_path, "widget", language="go")
    file_symbols = _FileSymbols(
        path=file_path, module=module, classes=[], methods_by_class_id={}, functions=[]
    )

    gaps = _gaps_for_file(file_symbols)

    assert any(g.qualified_name == "widget" and g.kind == "module" for g in gaps)


def test_gaps_skip_a_documented_go_package():
    file_path = "pkg/widget.go"
    module = _module(file_path, "widget", docstring="Package widget renders things.", language="go")
    file_symbols = _FileSymbols(
        path=file_path, module=module, classes=[], methods_by_class_id={}, functions=[]
    )

    gaps = _gaps_for_file(file_symbols)

    assert gaps == []


def test_gaps_flag_an_undocumented_exported_ts_function():
    gaps = _gaps_for_file(_ts_function_file_symbols("web/widget.ts", is_exported=True))

    assert any(g.qualified_name == "helper" for g in gaps)


def test_gaps_skip_an_undocumented_js_function_regardless_of_export():
    gaps = _gaps_for_file(_ts_function_file_symbols("web/widget.js", is_exported=True))

    assert gaps == []


def _go_file_graph() -> Graph:
    file_path = "pkg/widget.go"
    module = _module(
        file_path, "widget", docstring="Package widget renders things.", language="go"
    )
    type_ = _class(
        file_path,
        "Widget",
        module.id,
        docstring="Widget is a thing.",
        language="go",
        is_exported=True,
    )
    documented_fn = _function(
        file_path,
        "Helper",
        module.id,
        docstring="Helper does the work.",
        language="go",
        is_exported=True,
    )
    undocumented_fn = _function(file_path, "helper", module.id, language="go", is_exported=False)
    nodes = {
        "dir::pkg": HierarchyNode(
            id="dir::pkg", name="pkg", level=HierarchyLevel.SYSTEM, source_path="pkg"
        ),
        f"component::{file_path}": HierarchyNode(
            id=f"component::{file_path}",
            name="widget.go",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path=file_path,
        ),
    }
    symbols = {s.id: s for s in (module, type_, documented_fn, undocumented_fn)}
    return Graph(nodes=nodes, symbols=symbols)


def test_generate_wiki_shows_full_breakdown_for_a_go_file(tmp_path):
    result = generate_wiki(_go_file_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    text = (result.output_dir / "files" / "pkg" / "widget.md").read_text(encoding="utf-8")
    assert "Package widget renders things." in text
    assert "### Widget" in text
    assert "Widget is a thing." in text
    assert "`Helper`" in text
    assert "Helper does the work." in text
    assert "`helper`" in text


def _ts_file_graph(file_path: str) -> Graph:
    module = _module(file_path, "mod", docstring="File overview.", language="typescript")
    documented_fn = _function(
        file_path, "helper", module.id, docstring="Helps.", language="typescript"
    )
    nodes = {
        "dir::web": HierarchyNode(
            id="dir::web", name="web", level=HierarchyLevel.SYSTEM, source_path="web"
        ),
        f"component::{file_path}": HierarchyNode(
            id=f"component::{file_path}",
            name=Path(file_path).name,
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::web"],
            source_path=file_path,
        ),
    }
    symbols = {s.id: s for s in (module, documented_fn)}
    return Graph(nodes=nodes, symbols=symbols)


@pytest.mark.parametrize("file_path", ["web/widget.ts", "web/Widget.tsx", "web/util.js"])
def test_generate_wiki_shows_full_breakdown_for_ts_js_files(tmp_path, file_path):
    result = generate_wiki(_ts_file_graph(file_path), tmp_path, tmp_path / ".codechroma" / "wiki")

    page_path = result.output_dir / "files" / Path(file_path).with_suffix(".md")
    text = page_path.read_text(encoding="utf-8")
    assert "File overview." in text
    assert "`helper`" in text
    assert "Helps." in text


def _java_file_graph() -> Graph:
    file_path = "pkg/Greeter.java"
    module = _module(file_path, "Greeter", language="java")
    class_ = _class(file_path, "Greeter", module.id, docstring="Greets people.", language="java")
    documented_fn = _function(
        file_path, "hello", class_.id, docstring="Says hello.", language="java"
    )
    nodes = {
        "dir::pkg": HierarchyNode(
            id="dir::pkg", name="pkg", level=HierarchyLevel.SYSTEM, source_path="pkg"
        ),
        f"component::{file_path}": HierarchyNode(
            id=f"component::{file_path}",
            name="Greeter.java",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path=file_path,
        ),
    }
    symbols = {s.id: s for s in (module, class_, documented_fn)}
    return Graph(nodes=nodes, symbols=symbols)


def test_generate_wiki_shows_full_breakdown_for_a_java_file(tmp_path):
    result = generate_wiki(_java_file_graph(), tmp_path, tmp_path / ".codechroma" / "wiki")

    text = (result.output_dir / "files" / "pkg" / "Greeter.md").read_text(encoding="utf-8")
    assert "### Greeter" in text
    assert "Greets people." in text
    assert "`hello`" in text
    assert "Says hello." in text
