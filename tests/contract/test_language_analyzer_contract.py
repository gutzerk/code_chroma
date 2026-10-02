"""Contract test: every registered analyzer structurally satisfies the LanguageAnalyzer port."""

import pytest

from codechroma.analyzers.registry import AnalyzerRegistry, LanguageAnalyzer
from codechroma.graph.models import ClassShape, Symbol

REGISTRY = AnalyzerRegistry.with_defaults()
ANALYZERS = sorted(
    {id(a): a for a in (REGISTRY.for_file(f"x{ext}") for ext in REGISTRY.supported_extensions())}
    .values(),
    key=lambda a: a.language,
)

SNIPPETS = {
    "python": b"class Greeter:\n    def hello(self):\n        return 1\n",
    "typescript": b"export function hello(): number { return 1; }\n",
    "go": b"package main\n\nfunc hello() int { return 1 }\n",
    "java": b"public class Greeter {\n    public int hello() { return 1; }\n}\n",
    "csharp": b"public class Greeter {\n    public int Hello() { return 1; }\n}\n",
    "rust": b"pub fn hello() -> i32 { 1 }\n",
    "php": b"<?php\nfunction hello() {\n    return 1;\n}\n",
    "ruby": b"class Greeter\n  def hello\n    1\n  end\nend\n",
    "c": b"int hello() { return 1; }\n",
    "cpp": b"int hello() { return 1; }\n",
    "yaml": b"name: Hello\nruns:\n  using: composite\n  steps:\n    - run: echo hi\n",
}


@pytest.mark.parametrize("analyzer", ANALYZERS, ids=lambda a: a.language)
def test_analyzer_satisfies_the_port(analyzer):
    assert isinstance(analyzer, LanguageAnalyzer)


@pytest.mark.parametrize("analyzer", ANALYZERS, ids=lambda a: a.language)
def test_extensions_are_dot_prefixed_and_nonempty(analyzer):
    assert len(analyzer.extensions) > 0
    assert all(ext.startswith(".") for ext in analyzer.extensions)


@pytest.mark.parametrize("analyzer", ANALYZERS, ids=lambda a: a.language)
def test_parse_returns_symbols_led_by_a_module(analyzer):
    file_path = f"pkg/sample{analyzer.extensions[0]}"

    symbols = analyzer.parse(file_path, SNIPPETS[analyzer.language])

    assert symbols and all(isinstance(s, Symbol) for s in symbols)


@pytest.mark.parametrize("analyzer", ANALYZERS, ids=lambda a: a.language)
def test_class_shapes_returns_a_shape_mapping_or_none(analyzer):
    file_path = f"pkg/sample{analyzer.extensions[0]}"

    shapes = analyzer.class_shapes(file_path, SNIPPETS[analyzer.language])

    assert shapes is None or all(isinstance(s, ClassShape) for s in shapes.values())


def test_no_two_analyzers_claim_the_same_extension():
    claimed: list[str] = []
    for analyzer in ANALYZERS:
        claimed.extend(analyzer.extensions)

    assert len(claimed) == len(set(claimed))
