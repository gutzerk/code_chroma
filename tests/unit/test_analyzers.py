"""Unit tests for AnalyzerRegistry, PythonAnalyzer, TypeScriptAnalyzer, and GoAnalyzer."""

from codechroma.analyzers.go_analyzer import GoAnalyzer
from codechroma.analyzers.python_analyzer import PythonAnalyzer
from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
from codechroma.graph.models import SymbolKind


def test_registry_dispatches_by_extension():
    registry = AnalyzerRegistry.with_defaults()
    assert isinstance(registry.for_file("a/b.py"), PythonAnalyzer)
    assert isinstance(registry.for_file("a/b.ts"), TypeScriptAnalyzer)
    assert isinstance(registry.for_file("a/b.tsx"), TypeScriptAnalyzer)
    assert isinstance(registry.for_file("a/b.go"), GoAnalyzer)
    assert registry.for_file("a/b.zig") is None


def test_registry_supported_extensions():
    registry = AnalyzerRegistry.with_defaults()
    extensions = registry.supported_extensions()
    assert ".py" in extensions
    assert ".ts" in extensions
    assert ".go" in extensions


def test_python_analyzer_extracts_module_class_and_function():
    source = b"""from shared.util import helper


class Widget:
    def render(self):
        value = helper()
        return value


def standalone():
    return 1
"""
    symbols = PythonAnalyzer().parse("pkg/widget.py", source)
    by_kind = {(s.kind, s.qualified_name): s for s in symbols}

    module = next(s for s in symbols if s.kind == SymbolKind.MODULE)
    assert module.qualified_name == "pkg.widget"
    assert module.imports == {"helper": "shared.util"}

    assert (SymbolKind.CLASS, "Widget") in by_kind
    assert (SymbolKind.FUNCTION, "Widget.render") in by_kind
    assert (SymbolKind.FUNCTION, "standalone") in by_kind

    render = by_kind[(SymbolKind.FUNCTION, "Widget.render")]
    assert "helper" in render.references
    assert render.parent_symbol_id == by_kind[(SymbolKind.CLASS, "Widget")].id
    assert render.body_statements


def test_python_analyzer_handles_unparseable_source_without_raising():
    symbols = PythonAnalyzer().parse("broken.py", b"def foo(:\n")
    assert any(s.kind == SymbolKind.MODULE for s in symbols)


def test_typescript_analyzer_extracts_module_and_function():
    source = b"""import { helper } from "./util";

export function render(name: string): string {
    return helper(name);
}
"""
    symbols = TypeScriptAnalyzer().parse("widget.ts", source)
    module = next(s for s in symbols if s.kind == SymbolKind.MODULE)
    assert module.imports == {"helper": "./util"}

    render = next(s for s in symbols if s.kind == SymbolKind.FUNCTION)
    assert render.name == "render"
    assert "helper" in render.references


def test_typescript_analyzer_extracts_class_and_method():
    source = b"""class Widget {
    render(): void {}
}
"""
    symbols = TypeScriptAnalyzer().parse("widget.ts", source)
    kinds = {(s.kind, s.qualified_name) for s in symbols}
    assert (SymbolKind.CLASS, "Widget") in kinds
    assert (SymbolKind.FUNCTION, "Widget.render") in kinds


def test_go_analyzer_extracts_module_type_function_and_method():
    source = b"""package widget

import (
\t"fmt"
\tu "shared/util"
)

type Widget struct {
\tName string
}

func (w Widget) Render() string {
\tvalue := helper()
\tfmt.Println(value)
\treturn value
}

func standalone() int {
\treturn 1
}
"""
    symbols = GoAnalyzer().parse("pkg/widget.go", source)
    by_kind = {(s.kind, s.qualified_name): s for s in symbols}

    module = next(s for s in symbols if s.kind == SymbolKind.MODULE)
    assert module.qualified_name == "pkg.widget"
    assert module.imports == {"fmt": "fmt", "u": "shared/util"}

    assert (SymbolKind.CLASS, "Widget") in by_kind
    assert (SymbolKind.FUNCTION, "Widget.Render") in by_kind
    assert (SymbolKind.FUNCTION, "standalone") in by_kind

    render = by_kind[(SymbolKind.FUNCTION, "Widget.Render")]
    assert "helper" in render.references
    assert "Println" in render.references
    assert render.parent_symbol_id == by_kind[(SymbolKind.CLASS, "Widget")].id
    assert render.body_statements


def test_go_analyzer_handles_unparseable_source_without_raising():
    symbols = GoAnalyzer().parse("broken.go", b"func foo( {\n")
    assert any(s.kind == SymbolKind.MODULE for s in symbols)
