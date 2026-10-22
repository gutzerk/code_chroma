"""Languages without class-shape extraction return None, keeping them out of pattern detection."""

import pytest

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
from codechroma.graph.models import SymbolKind

_CLASS_SOURCES = {
    "Greeter.java": b"public class Greeter {\n    private int count;\n    void hi() {}\n}\n",
    "Greeter.cs": b"public class Greeter {\n    private int count;\n    void Hi() {}\n}\n",
    "greeter.ts": b"export class Greeter {\n    count = 0;\n    hi(): void {}\n}\n",
    "greeter.rs": b"pub struct Greeter { count: i32 }\nimpl Greeter { fn hi(&self) {} }\n",
    "greeter.php": b"<?php\nclass Greeter {\n    private $count;\n    function hi() {}\n}\n",
    "greeter.rb": b"class Greeter\n  def hi\n    @count = 1\n  end\nend\n",
    "greeter.cpp": b"class Greeter {\n public:\n  int count;\n  void hi() {}\n};\n",
}


@pytest.mark.parametrize("file_path", sorted(_CLASS_SOURCES))
def test_class_shapes_is_none_for_languages_without_extraction(file_path):
    analyzer = AnalyzerRegistry.with_defaults().for_file(file_path)

    shapes = analyzer.class_shapes(file_path, _CLASS_SOURCES[file_path])

    assert shapes is None


@pytest.mark.parametrize("file_path", sorted(_CLASS_SOURCES))
def test_parse_still_yields_a_class_like_symbol_when_shapes_are_deferred(file_path):
    analyzer = AnalyzerRegistry.with_defaults().for_file(file_path)

    symbols = analyzer.parse(file_path, _CLASS_SOURCES[file_path])

    assert any(s.name == "Greeter" for s in symbols)


def test_typescript_analyzer_handles_unparseable_source_without_raising():
    symbols = TypeScriptAnalyzer().parse("broken.ts", b"export function foo( {\n")

    assert any(s.kind == SymbolKind.MODULE for s in symbols)
